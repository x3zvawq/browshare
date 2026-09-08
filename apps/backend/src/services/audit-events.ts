import {
  BrowShareError,
  decodePageCursor,
  encodePageCursor,
  isPublicId,
  normalizePageLimit,
} from '@browshare/common'
import type { AuditEvent, AuditEventListQuery, AuditEventListResponse } from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { auditEvents, users } from '@browshare/database/schema'
import { and, desc, eq, gte, isNull, lt, lte, or, type SQL } from 'drizzle-orm'

const summaryColumns = {
  id: auditEvents.id,
  actorUserId: auditEvents.actorUserId,
  actorName: users.displayName,
  action: auditEvents.action,
  targetType: auditEvents.targetType,
  targetId: auditEvents.targetId,
  result: auditEvents.result,
  occurredAt: auditEvents.occurredAt,
}

export class AuditEventService {
  constructor(private readonly connection: DatabaseConnection) {}

  async list(query: AuditEventListQuery): Promise<AuditEventListResponse> {
    const filters: SQL[] = []
    if (query.actorUserId) {
      assertId(query.actorUserId)
      if (query.withoutActor) throw badRequest('Actor filters are mutually exclusive.')
      filters.push(eq(auditEvents.actorUserId, query.actorUserId))
    }
    if (query.withoutActor) filters.push(isNull(auditEvents.actorUserId))
    for (const key of ['action', 'targetType', 'targetId', 'result', 'requestId'] as const) {
      const value = query[key]
      if (value !== undefined) {
        if (!value.trim()) throw badRequest('Filters must not be blank.')
        filters.push(eq(auditEvents[key], value))
      }
    }
    if (query.from) filters.push(gte(auditEvents.occurredAt, query.from))
    if (query.to) filters.push(lte(auditEvents.occurredAt, query.to))
    if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to))
      throw badRequest('The start time must not be after the end time.')
    if (query.cursor) {
      const cursor = decodePageCursor(query.cursor)
      filters.push(
        or(
          lt(auditEvents.occurredAt, cursor.createdAt),
          and(eq(auditEvents.occurredAt, cursor.createdAt), lt(auditEvents.id, cursor.id)),
        )!,
      )
    }
    const limit = normalizePageLimit(query.limit)
    const rows = await this.connection.db
      .select(summaryColumns)
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(...filters))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit + 1)
    const items = rows
      .slice(0, limit)
      .map((row) => ({ ...row, occurredAt: new Date(row.occurredAt).toISOString() }))
    const last = items.at(-1),
      hasMore = rows.length > limit
    return {
      items,
      meta: {
        hasMore,
        nextCursor:
          hasMore && last ? encodePageCursor({ id: last.id, createdAt: last.occurredAt }) : null,
      },
    }
  }

  async get(id: string): Promise<AuditEvent> {
    assertId(id)
    const [row] = await this.connection.db
      .select({
        ...summaryColumns,
        requestId: auditEvents.requestId,
        sourceIpHash: auditEvents.sourceIpHash,
        changes: auditEvents.changes,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(eq(auditEvents.id, id))
    if (!row)
      throw new BrowShareError({
        code: 'NOT_FOUND',
        statusCode: 404,
        message: 'Audit event does not exist.',
      })
    // Writers own the nonsensitive payload contract; this read path never loads source objects.
    return { ...row, occurredAt: new Date(row.occurredAt).toISOString() }
  }
}

function badRequest(message: string) {
  return new BrowShareError({ code: 'BAD_REQUEST', statusCode: 400, message })
}
function assertId(id: string) {
  if (!isPublicId(id)) throw badRequest('ID must be a UUIDv7.')
}
