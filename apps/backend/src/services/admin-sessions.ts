import {
  BrowShareError,
  decodePageCursor,
  encodePageCursor,
  isPublicId,
  normalizePageLimit,
} from '@browshare/common'
import type {
  AdminTabSession,
  AdminTabSessionListQuery,
  AdminTabSessionListResponse,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { profiles, tabSessions, users, workers } from '@browshare/database/schema'
import { and, desc, eq, ilike, lt, notInArray, or, type SQL } from 'drizzle-orm'
import { queueSessionClose } from './session-closure.js'
import { sessionColumns, toSession } from './sessions.js'
import { escapeLike } from './search.js'
import type { AuditContext } from './users.js'

export class AdminSessionService {
  constructor(private readonly connection: DatabaseConnection) {}

  private query() {
    return this.connection.db
      .select({
        ...sessionColumns,
        user: { id: users.id, name: users.displayName },
        worker: { id: workers.id, name: workers.name },
        runtimeId: tabSessions.runtimeId,
        profileGeneration: tabSessions.profileGeneration,
        viewerGeneration: tabSessions.viewerGeneration,
        leaseExpiresAt: tabSessions.leaseExpiresAt,
        runtimeObservedAt: tabSessions.runtimeObservedAt,
        viewerConnectedAt: tabSessions.viewerConnectedAt,
        viewerDisconnectedAt: tabSessions.viewerDisconnectedAt,
        lastInputAt: tabSessions.lastInputAt,
        lastFrameChangedAt: tabSessions.lastFrameChangedAt,
      })
      .from(tabSessions)
      .innerJoin(profiles, eq(profiles.id, tabSessions.profileId))
      .innerJoin(users, eq(users.id, tabSessions.userId))
      .innerJoin(workers, eq(workers.id, tabSessions.workerId))
  }

  async list(query: AdminTabSessionListQuery): Promise<AdminTabSessionListResponse> {
    const filters: SQL[] = []
    if (query.scope !== 'ALL') filters.push(notInArray(tabSessions.status, ['CLOSED', 'FAILED']))
    if (query.status) filters.push(eq(tabSessions.status, query.status))
    for (const [column, id] of [
      [tabSessions.userId, query.userId],
      [tabSessions.profileId, query.profileId],
      [tabSessions.workerId, query.workerId],
    ] as const) {
      if (id) {
        assertId(id)
        filters.push(eq(column, id))
      }
    }
    if (query.search !== undefined) {
      const search = query.search.trim()
      if (!search)
        throw new BrowShareError({
          code: 'BAD_REQUEST',
          statusCode: 400,
          message: 'Search must not be blank.',
        })
      const pattern = `%${escapeLike(search)}%`
      filters.push(
        or(
          ilike(profiles.name, pattern),
          ilike(users.displayName, pattern),
          ilike(workers.name, pattern),
          ilike(tabSessions.displayName, pattern),
          ilike(tabSessions.remoteTitle, pattern),
        )!,
      )
    }
    if (query.cursor) {
      const cursor = decodePageCursor(query.cursor)
      filters.push(
        or(
          lt(tabSessions.createdAt, cursor.createdAt),
          and(eq(tabSessions.createdAt, cursor.createdAt), lt(tabSessions.id, cursor.id)),
        )!,
      )
    }
    const limit = normalizePageLimit(query.limit)
    const rows = await this.query()
      .where(and(...filters))
      .orderBy(desc(tabSessions.createdAt), desc(tabSessions.id))
      .limit(limit + 1)
    const items = rows.slice(0, limit).map(toAdminSession),
      last = items.at(-1),
      hasMore = rows.length > limit
    return {
      items,
      meta: {
        hasMore,
        nextCursor:
          hasMore && last ? encodePageCursor({ id: last.id, createdAt: last.createdAt }) : null,
      },
    }
  }

  async get(id: string): Promise<AdminTabSession> {
    assertId(id)
    const [row] = await this.query().where(eq(tabSessions.id, id))
    if (!row) throw notFound()
    return toAdminSession(row)
  }

  async close(id: string, context: AuditContext): Promise<AdminTabSession> {
    assertId(id)
    await this.connection.db.transaction(async (tx) => {
      const [scope] = await tx
        .select({ profileId: tabSessions.profileId })
        .from(tabSessions)
        .where(eq(tabSessions.id, id))
      if (!scope) throw notFound()
      // Use reconciliation's Profile -> Session order; the route checks terminate_any.
      await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, scope.profileId))
        .for('update')
      const [session] = await tx
        .select()
        .from(tabSessions)
        .where(eq(tabSessions.id, id))
        .for('update')
      if (!session) throw notFound()
      await queueSessionClose(tx, session, 'ADMIN_REQUESTED', context)
    })
    return this.get(id)
  }
}

function toAdminSession(
  row: Omit<AdminTabSession, 'recycling' | 'serverTime'> & { recycling: unknown },
): AdminTabSession {
  const utc = (value: string | null) => (value === null ? null : new Date(value).toISOString())
  return {
    ...row,
    ...toSession(row),
    leaseExpiresAt: utc(row.leaseExpiresAt),
    runtimeObservedAt: utc(row.runtimeObservedAt),
    viewerConnectedAt: utc(row.viewerConnectedAt),
    viewerDisconnectedAt: utc(row.viewerDisconnectedAt),
    lastInputAt: utc(row.lastInputAt),
    lastFrameChangedAt: utc(row.lastFrameChangedAt),
  }
}
function assertId(id: string) {
  if (!isPublicId(id))
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: 'ID must be a UUIDv7.',
    })
}
function notFound() {
  return new BrowShareError({
    code: 'NOT_FOUND',
    statusCode: 404,
    message: 'Session does not exist.',
  })
}
