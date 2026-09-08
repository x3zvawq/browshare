import { profileStorageColumns } from './storage.js'
import { queueSessionClose, releaseReservation } from './session-closure.js'
import {
  BrowShareError,
  createPublicId,
  decodePageCursor,
  encodePageCursor,
  isPublicId,
  normalizePageLimit,
} from '@browshare/common'
import {
  SessionRecycleStateSchema,
  decodeWorkerControlMessage,
  encodeWorkerControlMessage,
  type TabSession,
  type TabSessionListQuery,
  type TabSessionListResponse,
  type WorkerSessionCloseCommandMessage,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { auditEvents, profiles, sessionCloseOutbox, tabSessions } from '@browshare/database/schema'
import { and, asc, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import { Value } from 'typebox/value'
import { appendSessionEvent } from './session-events.js'
import { WorkerCommandError, type WorkerControlServer } from './worker-control-server.js'

export const sessionColumns = {
  ...profileStorageColumns,
  id: tabSessions.id,
  kind: tabSessions.kind,
  profileId: tabSessions.profileId,
  profileName: profiles.name,
  routeVersion: profiles.routeVersion,
  runtimeRouteVersion: sql<
    number | null
  >`case when ${tabSessions.runtimeId} = ${profiles.runtimeId} then ${profiles.runtimeRouteVersion} else null end`,
  runtimeProxyHealth: sql<
    TabSession['runtimeProxyHealth']
  >`case when ${tabSessions.runtimeId} = ${profiles.runtimeId} then ${profiles.runtimeProxyHealth} else null end`,
  restartRequired: sql<boolean>`coalesce(${tabSessions.runtimeId} = ${profiles.runtimeId} and ${profiles.runtimeRouteVersion} <> ${profiles.routeVersion}, false)`,
  status: tabSessions.status,
  displayName: tabSessions.displayName,
  remoteTitle: tabSessions.remoteTitle,
  recycling: tabSessions.recycling,
  hasCustomDisplayName: tabSessions.hasCustomDisplayName,
  createdAt: tabSessions.createdAt,
  updatedAt: tabSessions.updatedAt,
  closingAt: tabSessions.closingAt,
  closedAt: tabSessions.closedAt,
  closeReason: tabSessions.closeReason,
  failureCode: tabSessions.failureCode,
}

type SavedClose = typeof sessionCloseOutbox.$inferSelect

export class SessionService {
  readonly #active = new Map<string, Promise<void>>()
  #timer: NodeJS.Timeout | undefined
  #tick: Promise<void> | undefined
  #closed = false

  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: Pick<WorkerControlServer, 'dispatchSessionClose'>,
    private readonly onError: (cause: unknown) => void,
  ) {}

  start(): void {
    this.#timer = setInterval(() => this.#schedule(), 1000)
    this.#timer.unref()
    this.#schedule()
  }
  stop(): void {
    this.#closed = true
    clearInterval(this.#timer)
  }
  async drain(): Promise<void> {
    await this.#tick
    await Promise.allSettled(this.#active.values())
  }

  private query() {
    return this.connection.db
      .select(sessionColumns)
      .from(tabSessions)
      .innerJoin(profiles, eq(profiles.id, tabSessions.profileId))
  }
  async list(
    userId: string,
    query: TabSessionListQuery,
    kinds: ('NORMAL' | 'MAINTENANCE')[] = ['NORMAL', 'MAINTENANCE'],
  ): Promise<TabSessionListResponse> {
    assertId(userId)
    const filters: SQL[] = [eq(tabSessions.userId, userId), inArray(tabSessions.kind, kinds)]
    if (query.kind) filters.push(eq(tabSessions.kind, query.kind))
    if (query.profileId) {
      assertId(query.profileId)
      filters.push(eq(tabSessions.profileId, query.profileId))
    }
    if (query.status) filters.push(eq(tabSessions.status, query.status))
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
    const items = rows.slice(0, limit).map(toSession),
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
  async get(userId: string, sessionId: string): Promise<TabSession> {
    assertId(userId)
    assertId(sessionId)
    const [row] = await this.query().where(
      and(eq(tabSessions.id, sessionId), eq(tabSessions.userId, userId)),
    )
    if (!row) throw notFound()
    return toSession(row)
  }

  async rename(
    userId: string,
    sessionId: string,
    displayName: string | null,
    requestId?: string,
  ): Promise<TabSession> {
    assertId(userId)
    assertId(sessionId)
    const name = displayName?.trim() ?? null
    if (name !== null && (name.length === 0 || [...name].length > 256))
      throw new BrowShareError({
        code: 'BAD_REQUEST',
        message: 'Session name must contain 1–256 characters.',
        statusCode: 400,
      })
    await this.connection.db.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(tabSessions)
        .where(and(eq(tabSessions.id, sessionId), eq(tabSessions.userId, userId)))
        .for('update')
      if (!session) throw notFound()
      await tx
        .update(tabSessions)
        .set({
          displayName: name,
          hasCustomDisplayName: name !== null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(tabSessions.id, sessionId))
      await appendSessionEvent(tx, sessionId, 'session.renamed', { displayName: name })
      await tx.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: userId,
        targetType: 'session',
        targetId: sessionId,
        action: 'session.rename',
        result: 'SUCCEEDED',
        metadata: { displayName: name },
        ...(requestId === undefined ? {} : { requestId }),
      })
    })
    return this.get(userId, sessionId)
  }

  async close(userId: string, sessionId: string, requestId?: string): Promise<TabSession> {
    assertId(userId)
    assertId(sessionId)
    if (this.#closed) throw new Error('Session service is closed')
    await this.connection.db.transaction(async (tx) => {
      // Match reconciliation's Profile -> Session lock order; ownership is required even for admins.
      const [scope] = await tx
        .select({ profileId: tabSessions.profileId })
        .from(tabSessions)
        .where(and(eq(tabSessions.id, sessionId), eq(tabSessions.userId, userId)))
      if (!scope) throw notFound()
      await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, scope.profileId))
        .for('update')
      const [session] = await tx
        .select()
        .from(tabSessions)
        .where(and(eq(tabSessions.id, sessionId), eq(tabSessions.userId, userId)))
        .for('update')
      if (!session) throw notFound()
      await queueSessionClose(tx, session, 'USER_REQUESTED', {
        actorUserId: userId,
        ...(requestId === undefined ? {} : { requestId }),
      })
    })
    this.#schedule()
    return this.get(userId, sessionId)
  }

  #schedule(): void {
    if (this.#closed || this.#tick !== undefined) return
    this.#tick = this.#dispatchPending()
      .catch(this.onError)
      .finally(() => {
        this.#tick = undefined
      })
  }
  async #dispatchPending(): Promise<void> {
    const pending = await this.connection.db
      .select()
      .from(sessionCloseOutbox)
      .orderBy(asc(sessionCloseOutbox.createdAt))
      .limit(256)
    for (const operation of pending) {
      if (this.#closed || this.#active.size >= 32) break
      if (this.#active.has(operation.id)) continue
      const run = this.#deliver(operation)
        .catch(this.onError)
        .finally(() => this.#active.delete(operation.id))
      this.#active.set(operation.id, run)
    }
  }
  async #deliver(operation: SavedClose): Promise<void> {
    const command = decodeWorkerControlMessage(
      encodeWorkerControlMessage(operation.command as WorkerSessionCloseCommandMessage),
    )
    if (
      command.type !== 'session.close' ||
      command.messageId !== operation.id ||
      command.payload.sessionId !== operation.sessionId
    )
      throw new Error('Stored Session close identity is invalid')
    let completedAt: string | undefined, errorCode: string | undefined
    try {
      if (Date.parse(operation.expiresAt) <= Date.now()) errorCode = 'WORKER_COMMAND_TIMEOUT'
      else {
        const result = await this.control.dispatchSessionClose(command)
        if (result.payload.outcome === 'SUCCEEDED') completedAt = result.payload.completedAt
        else errorCode = result.payload.error!.code
      }
    } catch (cause) {
      if (this.#closed) return
      if (
        cause instanceof WorkerCommandError &&
        cause.code === 'WORKER_UNAVAILABLE' &&
        Date.parse(operation.expiresAt) > Date.now()
      )
        return
      if (!(cause instanceof WorkerCommandError)) throw cause
      errorCode = cause.code
    }
    if (this.#closed) return
    await this.connection.db.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(tabSessions)
        .where(eq(tabSessions.id, operation.sessionId))
        .for('update')
      const [pending] = await tx
        .select({ id: sessionCloseOutbox.id })
        .from(sessionCloseOutbox)
        .where(eq(sessionCloseOutbox.id, operation.id))
      if (!pending) return
      if (session?.status === 'CLOSING') {
        if (completedAt !== undefined) {
          await tx
            .update(tabSessions)
            .set({
              status: 'CLOSED',
              closedAt: sql`clock_timestamp()`,
              updatedAt: sql`clock_timestamp()`,
              runtimeObservedAt: completedAt,
            })
            .where(eq(tabSessions.id, session.id))
          await releaseReservation(tx, session.id, session.closeReason!)
          await appendSessionEvent(tx, session.id, 'session.closed', {
            reason: session.closeReason,
          })
        } else {
          // Delivery failure is not cleanup proof. Periodic snapshots retain the closing intent.
          await appendSessionEvent(tx, session.id, 'session.close.delivery.failed', {
            code: errorCode,
          })
        }
      }
      await tx.delete(sessionCloseOutbox).where(eq(sessionCloseOutbox.id, operation.id))
    })
  }
}

export function toSession(
  row: Omit<TabSession, 'recycling' | 'serverTime'> & { recycling: unknown },
): TabSession {
  if (row.recycling !== null && !Value.Check(SessionRecycleStateSchema, row.recycling))
    throw new Error('Stored Session recycling fact is invalid')
  return {
    ...row,
    recycling: row.recycling,
    serverTime: new Date().toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    closingAt: row.closingAt === null ? null : new Date(row.closingAt).toISOString(),
    closedAt: row.closedAt === null ? null : new Date(row.closedAt).toISOString(),
  }
}
function assertId(value: string): void {
  if (!isPublicId(value))
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: 'ID must be a UUIDv7.',
      statusCode: 400,
    })
}
function notFound(): BrowShareError {
  return new BrowShareError({
    code: 'NOT_FOUND',
    message: 'Session does not exist.',
    statusCode: 404,
  })
}
