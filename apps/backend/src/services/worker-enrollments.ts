import { createHash, randomBytes } from 'node:crypto'

import {
  BrowShareError,
  createPublicId,
  decodePageCursor,
  encodePageCursor,
  normalizePageLimit,
} from '@browshare/common'
import type {
  CreateWorkerEnrollmentRequest,
  IssuedWorkerEnrollmentResponse,
  WorkerEnrollmentListQuery,
  WorkerEnrollmentListResponse,
  WorkerEnrollmentResponse,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { auditEvents, workerEnrollments } from '@browshare/database/schema'
import { and, desc, eq, lt, lte, or, sql, type SQL } from 'drizzle-orm'

import type { AuditContext } from './users.js'

const DEFAULT_ENROLLMENT_LIFETIME_SECONDS = 15 * 60
const TOKEN_PREFIX = 'bwe_'

type WorkerEnrollmentRecord = typeof workerEnrollments.$inferSelect

export interface WorkerEnrollmentPort {
  list(query: WorkerEnrollmentListQuery): Promise<WorkerEnrollmentListResponse>
  create(
    input: CreateWorkerEnrollmentRequest,
    context: AuditContext,
  ): Promise<IssuedWorkerEnrollmentResponse>
  revoke(enrollmentId: string, context: AuditContext): Promise<WorkerEnrollmentResponse>
}

export class WorkerEnrollmentService implements WorkerEnrollmentPort {
  constructor(private readonly connection: DatabaseConnection) {}

  async list(query: WorkerEnrollmentListQuery): Promise<WorkerEnrollmentListResponse> {
    await this.expireStale()
    const limit = normalizePageLimit(query.limit)
    const cursor = query.cursor === undefined ? undefined : decodePageCursor(query.cursor)
    const filters: SQL[] = []
    if (query.status !== undefined && query.status !== 'ALL') {
      filters.push(eq(workerEnrollments.status, query.status))
    }
    if (cursor !== undefined) {
      filters.push(
        or(
          lt(workerEnrollments.createdAt, cursor.createdAt),
          and(
            eq(workerEnrollments.createdAt, cursor.createdAt),
            lt(workerEnrollments.id, cursor.id),
          ),
        )!,
      )
    }

    const records = await this.connection.db
      .select()
      .from(workerEnrollments)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(workerEnrollments.createdAt), desc(workerEnrollments.id))
      .limit(limit + 1)
    const hasMore = records.length > limit
    const page = records.slice(0, limit)
    const last = page.at(-1)
    return {
      items: page.map(toResponse),
      meta: {
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? encodePageCursor({ id: last.id, createdAt: last.createdAt })
            : null,
      },
    }
  }

  async create(
    input: CreateWorkerEnrollmentRequest,
    context: AuditContext,
  ): Promise<IssuedWorkerEnrollmentResponse> {
    const displayName = normalizeDisplayName(input.displayName)
    const lifetimeSeconds = input.expiresInSeconds ?? DEFAULT_ENROLLMENT_LIFETIME_SECONDS
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    const id = createPublicId()
    const expiresAt = new Date(Date.now() + lifetimeSeconds * 1000).toISOString()
    const [record] = await this.connection.db.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(workerEnrollments)
        .values({
          id,
          tokenDigest: digestToken(token),
          displayName,
          createdByUserId: context.actorUserId,
          expiresAt,
        })
        .returning()
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        action: 'worker.enrollment.create',
        targetType: 'worker_enrollment',
        targetId: id,
        result: 'SUCCEEDED',
        requestId: context.requestId,
        changes: { displayName, expiresAt },
        metadata: {},
      })
      return inserted
    })
    if (record === undefined) throw new Error('Worker enrollment was not inserted')
    return { ...toResponse(record), token }
  }

  async revoke(enrollmentId: string, context: AuditContext): Promise<WorkerEnrollmentResponse> {
    await this.expireStale()
    return this.connection.db.transaction(async (transaction) => {
      const [record] = await transaction
        .update(workerEnrollments)
        .set({ status: 'REVOKED', revokedAt: sql`now()` })
        .where(and(eq(workerEnrollments.id, enrollmentId), eq(workerEnrollments.status, 'ACTIVE')))
        .returning()
      if (record === undefined) {
        const [existing] = await transaction
          .select({ status: workerEnrollments.status })
          .from(workerEnrollments)
          .where(eq(workerEnrollments.id, enrollmentId))
          .limit(1)
        if (existing === undefined) throw enrollmentNotFound()
        throw new BrowShareError({
          code: 'CONFLICT',
          message: `Only an active Worker Enrollment can be revoked; this enrollment is ${existing.status.toLowerCase()}.`,
          statusCode: 409,
        })
      }
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        action: 'worker.enrollment.revoke',
        targetType: 'worker_enrollment',
        targetId: enrollmentId,
        result: 'SUCCEEDED',
        requestId: context.requestId,
        changes: { status: 'REVOKED' },
        metadata: {},
      })
      return toResponse(record)
    })
  }

  private async expireStale(): Promise<void> {
    await this.connection.db
      .update(workerEnrollments)
      .set({ status: 'EXPIRED' })
      .where(
        and(eq(workerEnrollments.status, 'ACTIVE'), lte(workerEnrollments.expiresAt, sql`now()`)),
      )
  }
}

function toResponse(record: WorkerEnrollmentRecord): WorkerEnrollmentResponse {
  return {
    id: record.id,
    displayName: record.displayName,
    status: record.status,
    expiresAt: toIsoTimestamp(record.expiresAt),
    consumedAt: toNullableIsoTimestamp(record.consumedAt),
    consumedByWorkerId: record.consumedByWorkerId,
    revokedAt: toNullableIsoTimestamp(record.revokedAt),
    createdAt: toIsoTimestamp(record.createdAt),
  }
}

function toIsoTimestamp(value: string): string {
  return new Date(value).toISOString()
}

function toNullableIsoTimestamp(value: string | null): string | null {
  return value === null ? null : toIsoTimestamp(value)
}

function normalizeDisplayName(value: string | undefined): string | null {
  if (value === undefined) return null
  const displayName = value.trim()
  if (displayName.length === 0 || displayName.length > 128) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: 'Display name must contain between 1 and 128 characters.',
      statusCode: 400,
    })
  }
  return displayName
}

function digestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function enrollmentNotFound(): BrowShareError {
  return new BrowShareError({
    code: 'NOT_FOUND',
    message: 'The Worker Enrollment does not exist.',
    statusCode: 404,
  })
}
