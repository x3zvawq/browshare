import { createHash, randomBytes } from 'node:crypto'

import { BrowShareError, createPublicId, isPublicId } from '@browshare/common'
import type {
  CreateWorkerCredentialRotationRequest,
  IssuedWorkerCredentialRotationResponse,
  RetireWorkerResponse,
  RotateWorkerCredentialRequest,
  RotateWorkerCredentialResponse,
  WorkerCredentialListResponse,
  WorkerCredentialResponse,
  WorkerCredentialRotationListResponse,
  WorkerCredentialRotationResponse,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  profiles,
  tabSessions,
  workerCredentialRotations,
  workerCredentials,
  workers,
} from '@browshare/database/schema'
import { and, count, desc, eq, gt, isNull, lte, ne, notInArray, sql } from 'drizzle-orm'

import type { AuditContext } from './users.js'
import type { WorkerCertificateAuthority } from './worker-certificate-authority.js'
import type { WorkerControlLifecyclePort } from './workers.js'

const ROTATION_TOKEN_PATTERN = /^bwcr_[A-Za-z0-9_-]{43}$/u
const DEFAULT_ROTATION_LIFETIME_SECONDS = 900

export interface WorkerCredentialPort {
  listCredentials(workerId: string): Promise<WorkerCredentialListResponse>
  listRotations(workerId: string): Promise<WorkerCredentialRotationListResponse>
  createRotation(
    workerId: string,
    input: CreateWorkerCredentialRotationRequest,
    context: AuditContext,
  ): Promise<IssuedWorkerCredentialRotationResponse>
  revokeRotation(
    workerId: string,
    rotationId: string,
    context: AuditContext,
  ): Promise<WorkerCredentialRotationResponse>
  rotate(
    token: string,
    input: RotateWorkerCredentialRequest,
    context: { readonly requestId: string },
  ): Promise<RotateWorkerCredentialResponse>
  revokeCredential(
    workerId: string,
    credentialId: string,
    reason: string | undefined,
    context: AuditContext,
  ): Promise<WorkerCredentialResponse>
  retire(
    workerId: string,
    expectedName: string,
    context: AuditContext,
  ): Promise<RetireWorkerResponse>
}

type CredentialRecord = typeof workerCredentials.$inferSelect
type RotationRecord = typeof workerCredentialRotations.$inferSelect

export class WorkerCredentialService implements WorkerCredentialPort {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly certificateAuthority: WorkerCertificateAuthority,
    private readonly controlUrl: string,
    private readonly control: WorkerControlLifecyclePort,
  ) {}

  async listCredentials(workerId: string): Promise<WorkerCredentialListResponse> {
    assertWorkerId(workerId)
    await this.expireCredentials(workerId)
    await this.assertWorkerExists(workerId)
    const records = await this.connection.db
      .select()
      .from(workerCredentials)
      .where(eq(workerCredentials.workerId, workerId))
      .orderBy(desc(workerCredentials.createdAt), desc(workerCredentials.id))
    return { items: records.map((record) => this.toCredentialResponse(record)) }
  }

  async listRotations(workerId: string): Promise<WorkerCredentialRotationListResponse> {
    assertWorkerId(workerId)
    await this.expireRotations(workerId)
    await this.assertWorkerExists(workerId)
    const records = await this.connection.db
      .select()
      .from(workerCredentialRotations)
      .where(eq(workerCredentialRotations.workerId, workerId))
      .orderBy(desc(workerCredentialRotations.createdAt), desc(workerCredentialRotations.id))
    return { items: records.map(toRotationResponse) }
  }

  async createRotation(
    workerId: string,
    input: CreateWorkerCredentialRotationRequest,
    context: AuditContext,
  ): Promise<IssuedWorkerCredentialRotationResponse> {
    assertWorkerId(workerId)
    const control = this.control.getWorkerControlStatus(workerId)
    if (!control.ready || control.credentialId === null) {
      throw new BrowShareError({
        code: 'WORKER_UNAVAILABLE',
        message: 'Worker must have a ready control connection before credential rotation.',
        statusCode: 409,
      })
    }
    const expiresInSeconds = input.expiresInSeconds ?? DEFAULT_ROTATION_LIFETIME_SECONDS
    const token = `bwcr_${randomBytes(32).toString('base64url')}`
    const tokenDigest = digestToken(token)
    const rotationId = createPublicId()
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()

    const record = await this.connection.db.transaction(async (transaction) => {
      const [worker] = await transaction
        .select({ status: workers.status })
        .from(workers)
        .where(and(eq(workers.id, workerId), isNull(workers.deletedAt)))
        .for('update')
        .limit(1)
      if (worker === undefined) throw workerNotFound()
      if (worker.status === 'DISABLED') {
        throw new BrowShareError({
          code: 'WORKER_UNAVAILABLE',
          message: 'Disabled Workers cannot start credential rotation.',
          statusCode: 409,
        })
      }
      const [currentCredential] = await transaction
        .select({ id: workerCredentials.id })
        .from(workerCredentials)
        .where(
          and(
            eq(workerCredentials.id, control.credentialId!),
            eq(workerCredentials.workerId, workerId),
            eq(workerCredentials.status, 'ACTIVE'),
            gt(workerCredentials.expiresAt, sql`now()`),
          ),
        )
        .limit(1)
      if (currentCredential === undefined) {
        throw new BrowShareError({
          code: 'WORKER_UNAVAILABLE',
          message: 'The connected Worker credential is no longer active.',
          statusCode: 409,
        })
      }

      await transaction
        .update(workerCredentialRotations)
        .set({ status: 'REVOKED', revokedAt: sql`now()` })
        .where(
          and(
            eq(workerCredentialRotations.workerId, workerId),
            eq(workerCredentialRotations.status, 'ACTIVE'),
          ),
        )
      const [created] = await transaction
        .insert(workerCredentialRotations)
        .values({
          id: rotationId,
          workerId,
          replacesCredentialId: currentCredential.id,
          tokenDigest,
          createdByUserId: context.actorUserId,
          expiresAt,
        })
        .returning()
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        action: 'worker.credential.rotation.create',
        targetType: 'worker',
        targetId: workerId,
        result: 'SUCCEEDED',
        requestId: context.requestId,
        changes: {
          rotationId,
          replacesCredentialId: currentCredential.id,
          expiresAt,
        },
        metadata: {},
      })
      return created!
    })
    return { ...toRotationResponse(record), token }
  }

  async revokeRotation(
    workerId: string,
    rotationId: string,
    context: AuditContext,
  ): Promise<WorkerCredentialRotationResponse> {
    assertWorkerId(workerId)
    assertPublicId(rotationId, 'Worker credential rotation ID')
    await this.expireRotations(workerId)
    const record = await this.connection.db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(workerCredentialRotations)
        .where(
          and(
            eq(workerCredentialRotations.id, rotationId),
            eq(workerCredentialRotations.workerId, workerId),
          ),
        )
        .for('update')
        .limit(1)
      if (existing === undefined) throw rotationNotFound()
      if (existing.status !== 'ACTIVE') {
        throw new BrowShareError({
          code: 'CONFLICT',
          message: `Only an active Worker credential rotation can be revoked; this rotation is ${existing.status.toLowerCase()}.`,
          statusCode: 409,
        })
      }
      const [updated] = await transaction
        .update(workerCredentialRotations)
        .set({ status: 'REVOKED', revokedAt: sql`now()` })
        .where(eq(workerCredentialRotations.id, rotationId))
        .returning()
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        action: 'worker.credential.rotation.revoke',
        targetType: 'worker',
        targetId: workerId,
        result: 'SUCCEEDED',
        requestId: context.requestId,
        changes: { rotationId, status: 'REVOKED' },
        metadata: {},
      })
      return updated!
    })
    return toRotationResponse(record)
  }

  async rotate(
    token: string,
    input: RotateWorkerCredentialRequest,
    context: { readonly requestId: string },
  ): Promise<RotateWorkerCredentialResponse> {
    if (!ROTATION_TOKEN_PATTERN.test(token)) throw invalidRotation()
    assertWorkerId(input.workerId)
    assertPublicId(input.currentCredentialId, 'Current Worker credential ID')
    const tokenDigest = digestToken(token)
    await this.connection.db
      .update(workerCredentialRotations)
      .set({ status: 'EXPIRED' })
      .where(
        and(
          eq(workerCredentialRotations.tokenDigest, tokenDigest),
          eq(workerCredentialRotations.status, 'ACTIVE'),
          lte(workerCredentialRotations.expiresAt, sql`now()`),
        ),
      )

    const credentialId = createPublicId()
    let certificate
    try {
      certificate = await this.certificateAuthority.issue(input.workerId, input.publicKeyPem)
    } catch (cause) {
      throw new BrowShareError({
        code: 'BAD_REQUEST',
        message: 'Worker public key cannot be used for credential rotation.',
        statusCode: 400,
        cause,
      })
    }

    const issued = await this.connection.db.transaction(async (transaction) => {
      const [claimed] = await transaction
        .update(workerCredentialRotations)
        .set({ status: 'CONSUMED', consumedAt: sql`now()` })
        .where(
          and(
            eq(workerCredentialRotations.tokenDigest, tokenDigest),
            eq(workerCredentialRotations.workerId, input.workerId),
            eq(workerCredentialRotations.replacesCredentialId, input.currentCredentialId),
            eq(workerCredentialRotations.status, 'ACTIVE'),
            gt(workerCredentialRotations.expiresAt, sql`now()`),
          ),
        )
        .returning({
          createdByUserId: workerCredentialRotations.createdByUserId,
          id: workerCredentialRotations.id,
        })
      if (claimed === undefined) return false

      const [worker] = await transaction
        .select({ id: workers.id })
        .from(workers)
        .where(
          and(
            eq(workers.id, input.workerId),
            ne(workers.status, 'DISABLED'),
            isNull(workers.deletedAt),
          ),
        )
        .limit(1)
      const [replacedCredential] = await transaction
        .select({ id: workerCredentials.id })
        .from(workerCredentials)
        .where(
          and(
            eq(workerCredentials.id, input.currentCredentialId),
            eq(workerCredentials.workerId, input.workerId),
            eq(workerCredentials.status, 'ACTIVE'),
            gt(workerCredentials.expiresAt, sql`now()`),
          ),
        )
        .limit(1)
      if (worker === undefined || replacedCredential === undefined) throw invalidRotation()

      await transaction.insert(workerCredentials).values({
        id: credentialId,
        workerId: input.workerId,
        certificateSerial: certificate.serialNumber,
        certificatePem: certificate.certificatePem,
        publicKeyPem: certificate.publicKeyPem,
        fingerprintSha256: certificate.fingerprintSha256,
        notBefore: certificate.notBefore,
        expiresAt: certificate.expiresAt,
      })
      await transaction
        .update(workerCredentialRotations)
        .set({ issuedCredentialId: credentialId })
        .where(eq(workerCredentialRotations.id, claimed.id))
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: claimed.createdByUserId,
        action: 'worker.credential.rotation.consume',
        targetType: 'worker',
        targetId: input.workerId,
        result: 'SUCCEEDED',
        requestId: context.requestId,
        changes: {
          rotationId: claimed.id,
          replacedCredentialId: input.currentCredentialId,
          credentialId,
        },
        metadata: {},
      })
      return true
    })
    if (!issued) throw invalidRotation()

    return {
      workerId: input.workerId,
      credentialId,
      certificatePem: certificate.certificatePem,
      caCertificatePem: this.certificateAuthority.certificatePem,
      certificateSerial: certificate.serialNumber,
      certificateFingerprintSha256: certificate.fingerprintSha256,
      certificateNotBefore: certificate.notBefore,
      certificateExpiresAt: certificate.expiresAt,
      controlUrl: this.controlUrl,
    }
  }

  async revokeCredential(
    workerId: string,
    credentialId: string,
    reason: string | undefined,
    context: AuditContext,
  ): Promise<WorkerCredentialResponse> {
    assertWorkerId(workerId)
    assertPublicId(credentialId, 'Worker credential ID')
    await this.expireCredentials(workerId)
    const record = await this.connection.db.transaction(async (transaction) => {
      const [worker] = await transaction
        .select({ status: workers.status })
        .from(workers)
        .where(and(eq(workers.id, workerId), isNull(workers.deletedAt)))
        .for('update')
        .limit(1)
      if (worker === undefined) throw workerNotFound()
      const [existing] = await transaction
        .select()
        .from(workerCredentials)
        .where(
          and(eq(workerCredentials.id, credentialId), eq(workerCredentials.workerId, workerId)),
        )
        .for('update')
        .limit(1)
      if (existing === undefined) throw credentialNotFound()
      if (existing.status !== 'ACTIVE') {
        throw new BrowShareError({
          code: 'CONFLICT',
          message: `Only an active Worker credential can be revoked; this credential is ${existing.status.toLowerCase()}.`,
          statusCode: 409,
        })
      }
      const activeCredentials = await transaction
        .select({ activeCount: count() })
        .from(workerCredentials)
        .where(
          and(
            eq(workerCredentials.workerId, workerId),
            eq(workerCredentials.status, 'ACTIVE'),
            gt(workerCredentials.expiresAt, sql`now()`),
            ne(workerCredentials.id, credentialId),
          ),
        )
      const activeCount = activeCredentials[0]?.activeCount ?? 0
      if (activeCount === 0 && worker.status !== 'DISABLED') {
        throw new BrowShareError({
          code: 'WORKER_LAST_CREDENTIAL',
          message: 'Disable the Worker before revoking its last active credential.',
          statusCode: 409,
        })
      }
      const revokeReason = reason?.trim() || 'administrator_revoked'
      const [updated] = await transaction
        .update(workerCredentials)
        .set({ status: 'REVOKED', revokedAt: sql`now()`, revokeReason })
        .where(eq(workerCredentials.id, credentialId))
        .returning()
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        action: 'worker.credential.revoke',
        targetType: 'worker',
        targetId: workerId,
        result: 'SUCCEEDED',
        requestId: context.requestId,
        changes: { credentialId, revokeReason },
        metadata: {},
      })
      return updated!
    })

    if (this.control.getWorkerControlStatus(workerId).credentialId === credentialId) {
      await this.connection.db
        .update(workers)
        .set({
          status: sql`case when ${workers.status} = 'ONLINE' then 'OFFLINE'::worker_status else ${workers.status} end`,
          updatedAt: sql`now()`,
        })
        .where(eq(workers.id, workerId))
      this.control.disconnectWorker(workerId, 'CREDENTIAL_REVOKED')
    }
    return this.toCredentialResponse(record)
  }

  async retire(
    workerId: string,
    expectedName: string,
    context: AuditContext,
  ): Promise<RetireWorkerResponse> {
    assertWorkerId(workerId)
    const result = await this.connection.db.transaction(async (transaction) => {
      const [worker] = await transaction
        .select({ name: workers.name, status: workers.status })
        .from(workers)
        .where(and(eq(workers.id, workerId), isNull(workers.deletedAt)))
        .for('update')
        .limit(1)
      if (worker === undefined) throw workerNotFound()
      if (expectedName !== worker.name) {
        throw new BrowShareError({
          code: 'WORKER_RETIREMENT_BLOCKED',
          message: 'Worker name confirmation does not match.',
          statusCode: 409,
        })
      }
      if (worker.status !== 'DISABLED') {
        throw retirementBlocked('Worker must be disabled before retirement.', {
          state: worker.status,
        })
      }
      const profileCounts = await transaction
        .select({ profileCount: count() })
        .from(profiles)
        .where(and(eq(profiles.workerId, workerId), isNull(profiles.deletedAt)))
      const activeSessionCounts = await transaction
        .select({ activeSessionCount: count() })
        .from(tabSessions)
        .where(
          and(
            eq(tabSessions.workerId, workerId),
            notInArray(tabSessions.status, ['CLOSED', 'FAILED']),
          ),
        )
      const profileCount = profileCounts[0]?.profileCount ?? 0
      const activeSessionCount = activeSessionCounts[0]?.activeSessionCount ?? 0
      if (profileCount > 0 || activeSessionCount > 0) {
        throw retirementBlocked('Worker still owns Profiles or active Tab Sessions.', {
          profileCount,
          activeSessionCount,
        })
      }

      const revokedCredentials = await transaction
        .update(workerCredentials)
        .set({ status: 'REVOKED', revokedAt: sql`now()`, revokeReason: 'worker_retired' })
        .where(
          and(eq(workerCredentials.workerId, workerId), eq(workerCredentials.status, 'ACTIVE')),
        )
        .returning({ id: workerCredentials.id })
      const revokedRotations = await transaction
        .update(workerCredentialRotations)
        .set({ status: 'REVOKED', revokedAt: sql`now()` })
        .where(
          and(
            eq(workerCredentialRotations.workerId, workerId),
            eq(workerCredentialRotations.status, 'ACTIVE'),
          ),
        )
        .returning({ id: workerCredentialRotations.id })
      const [retired] = await transaction
        .update(workers)
        .set({ status: 'DISABLED', deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(workers.id, workerId))
        .returning({ retiredAt: workers.deletedAt })
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        action: 'worker.retire',
        targetType: 'worker',
        targetId: workerId,
        result: 'SUCCEEDED',
        requestId: context.requestId,
        changes: {
          revokedCredentialCount: revokedCredentials.length,
          revokedRotationCount: revokedRotations.length,
          softDeleted: true,
        },
        metadata: {},
      })
      return {
        workerId,
        retiredAt: toIsoTimestamp(retired!.retiredAt!),
        revokedCredentialCount: revokedCredentials.length,
        revokedRotationCount: revokedRotations.length,
      }
    })
    this.control.disconnectWorker(workerId, 'RETIRED')
    return result
  }

  private async assertWorkerExists(workerId: string): Promise<void> {
    const [record] = await this.connection.db
      .select({ id: workers.id })
      .from(workers)
      .where(and(eq(workers.id, workerId), isNull(workers.deletedAt)))
      .limit(1)
    if (record === undefined) throw workerNotFound()
  }

  private async expireCredentials(workerId: string): Promise<void> {
    await this.connection.db
      .update(workerCredentials)
      .set({ status: 'EXPIRED' })
      .where(
        and(
          eq(workerCredentials.workerId, workerId),
          eq(workerCredentials.status, 'ACTIVE'),
          lte(workerCredentials.expiresAt, sql`now()`),
        ),
      )
  }

  private async expireRotations(workerId: string): Promise<void> {
    await this.connection.db
      .update(workerCredentialRotations)
      .set({ status: 'EXPIRED' })
      .where(
        and(
          eq(workerCredentialRotations.workerId, workerId),
          eq(workerCredentialRotations.status, 'ACTIVE'),
          lte(workerCredentialRotations.expiresAt, sql`now()`),
        ),
      )
  }

  private toCredentialResponse(record: CredentialRecord): WorkerCredentialResponse {
    return {
      id: record.id,
      workerId: record.workerId,
      status: record.status,
      certificateSerial: record.certificateSerial,
      certificateFingerprintSha256: record.fingerprintSha256,
      certificateNotBefore: toIsoTimestamp(record.notBefore),
      certificateExpiresAt: toIsoTimestamp(record.expiresAt),
      currentConnection:
        this.control.getWorkerControlStatus(record.workerId).credentialId === record.id,
      revokedAt: toNullableIsoTimestamp(record.revokedAt),
      revokeReason: record.revokeReason,
      createdAt: toIsoTimestamp(record.createdAt),
    }
  }
}

export function readWorkerCredentialRotationBearer(value: string | undefined): string {
  if (value === undefined) throw invalidRotation()
  const separator = value.indexOf(' ')
  if (separator < 1 || value.slice(0, separator).toLowerCase() !== 'bearer') {
    throw invalidRotation()
  }
  const token = value.slice(separator + 1)
  if (!ROTATION_TOKEN_PATTERN.test(token)) throw invalidRotation()
  return token
}

function toRotationResponse(record: RotationRecord): WorkerCredentialRotationResponse {
  return {
    id: record.id,
    workerId: record.workerId,
    replacesCredentialId: record.replacesCredentialId,
    issuedCredentialId: record.issuedCredentialId,
    status: record.status,
    expiresAt: toIsoTimestamp(record.expiresAt),
    consumedAt: toNullableIsoTimestamp(record.consumedAt),
    revokedAt: toNullableIsoTimestamp(record.revokedAt),
    createdAt: toIsoTimestamp(record.createdAt),
  }
}

function digestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function assertWorkerId(workerId: string): void {
  assertPublicId(workerId, 'Worker ID')
}

function assertPublicId(value: string, label: string): void {
  if (!isPublicId(value)) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: `${label} must be a UUIDv7 value.`,
      statusCode: 400,
    })
  }
}

function workerNotFound(): BrowShareError {
  return new BrowShareError({
    code: 'NOT_FOUND',
    message: 'Worker was not found.',
    statusCode: 404,
  })
}

function credentialNotFound(): BrowShareError {
  return new BrowShareError({
    code: 'WORKER_CREDENTIAL_NOT_FOUND',
    message: 'Worker credential was not found.',
    statusCode: 404,
  })
}

function rotationNotFound(): BrowShareError {
  return new BrowShareError({
    code: 'WORKER_CREDENTIAL_ROTATION_INVALID',
    message: 'Worker credential rotation was not found.',
    statusCode: 404,
  })
}

function invalidRotation(): BrowShareError {
  return new BrowShareError({
    code: 'WORKER_CREDENTIAL_ROTATION_INVALID',
    message: 'The Worker credential rotation token is invalid or unavailable.',
    statusCode: 401,
  })
}

function retirementBlocked(message: string, details: Record<string, unknown>): BrowShareError {
  return new BrowShareError({
    code: 'WORKER_RETIREMENT_BLOCKED',
    message,
    statusCode: 409,
    details,
  })
}

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toNullableIsoTimestamp(value: string | Date | null): string | null {
  return value === null ? null : toIsoTimestamp(value)
}
