import { createHash, randomBytes } from 'node:crypto'
import { BrowShareError, createPublicId, isPublicId } from '@browshare/common'
import type {
  DownloadAuthorization,
  DownloadClaim,
  DownloadListQuery,
  DownloadListResponse,
  RetainedDownload,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  authSessions,
  downloadClaims,
  sessionDownloads,
  workers,
} from '@browshare/database/schema'
import { and, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm'
import { lockAuthorizedSession } from './session-authorization.js'

type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]
export interface DownloadEndpointPort {
  getDownloadEndpoint(workerId: string): { endpoint: string; instanceId: string } | undefined
}

export class SessionDownloadService {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: DownloadEndpointPort,
  ) {}

  async list(
    userId: string,
    sessionId: string,
    query: DownloadListQuery,
  ): Promise<DownloadListResponse> {
    if (!isPublicId(sessionId) || (query.cursor !== undefined && !isPublicId(query.cursor)))
      throw failure('BAD_REQUEST', 400)
    return this.connection.db.transaction(async (tx) => {
      const session = await lockAuthorizedSession(tx, userId, sessionId)
      const limit = query.limit ?? 50
      const rows = await tx
        .select()
        .from(sessionDownloads)
        .where(
          and(
            eq(sessionDownloads.sessionId, sessionId),
            query.cursor === undefined ? undefined : lt(sessionDownloads.id, query.cursor),
          ),
        )
        .orderBy(desc(sessionDownloads.id))
        .limit(limit + 1)
      return {
        items: rows.slice(0, limit).map(metadata),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
        workerOnline: this.control.getDownloadEndpoint(session.workerId) !== undefined,
        serverTime: await clock(tx),
      }
    })
  }

  async prepare(
    userId: string,
    authSessionId: string,
    sessionId: string,
    downloadId: string,
    requestId?: string,
  ): Promise<DownloadClaim> {
    if (![sessionId, downloadId].every(isPublicId)) throw failure('BAD_REQUEST', 400)
    return this.connection.db.transaction(async (tx) => {
      const session = await lockAuthorizedSession(tx, userId, sessionId)
      const now = await clock(tx)
      await validPortalSession(tx, authSessionId, userId, now)
      const [file] = await tx
        .select()
        .from(sessionDownloads)
        .where(and(eq(sessionDownloads.id, downloadId), eq(sessionDownloads.sessionId, sessionId)))
        .for('update')
      available(file, now)
      await enabledWorker(tx, session.workerId)
      const target = this.control.getDownloadEndpoint(session.workerId)
      if (!target) throw failure('WORKER_UNAVAILABLE', 503)
      // Repeated clicks replace unused credentials; consumed credentials stay available for in-flight checks.
      await tx
        .delete(downloadClaims)
        .where(and(eq(downloadClaims.downloadId, downloadId), isNull(downloadClaims.consumedAt)))
      const token = randomBytes(32).toString('base64url'),
        claimId = createPublicId()
      const expiresAt = new Date(
        Math.min(Date.parse(now) + 60_000, Date.parse(file.expiresAt)),
      ).toISOString()
      await tx.insert(downloadClaims).values({
        id: claimId,
        downloadId,
        authSessionId,
        tokenDigest: digest(token),
        expiresAt,
        createdAt: now,
      })
      await tx.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: userId,
        action: 'session.download.authorize',
        targetType: 'download',
        targetId: downloadId,
        result: 'SUCCEEDED',
        metadata: { sessionId },
        ...(requestId === undefined ? {} : { requestId }),
      })
      return { claimId, token, endpoint: target.endpoint, expiresAt }
    })
  }

  consume(workerId: string, instanceId: string, token: string): Promise<DownloadAuthorization> {
    return this.#authorize(workerId, instanceId, { token })
  }

  check(workerId: string, instanceId: string, claimId: string): Promise<DownloadAuthorization> {
    return this.#authorize(workerId, instanceId, { claimId })
  }

  async #authorize(
    workerId: string,
    instanceId: string,
    input: { token: string } | { claimId: string },
  ): Promise<DownloadAuthorization> {
    return this.connection.db.transaction(async (tx) => {
      const condition =
        'token' in input
          ? eq(downloadClaims.tokenDigest, digest(input.token))
          : eq(downloadClaims.id, input.claimId)
      const [reference] = await tx
        .select({ claim: downloadClaims, file: sessionDownloads })
        .from(downloadClaims)
        .innerJoin(sessionDownloads, eq(downloadClaims.downloadId, sessionDownloads.id))
        .where(condition)
      if (!reference || reference.file.workerId !== workerId)
        throw failure('DOWNLOAD_CLAIM_INVALID', 403)
      await lockAuthorizedSession(tx, reference.file.userId, reference.file.sessionId)
      const [file] = await tx
        .select()
        .from(sessionDownloads)
        .where(eq(sessionDownloads.id, reference.file.id))
        .for('update')
      const [claim] = await tx
        .select()
        .from(downloadClaims)
        .where(eq(downloadClaims.id, reference.claim.id))
        .for('update')
      const now = await clock(tx)
      available(file, now)
      if (!claim) throw failure('DOWNLOAD_CLAIM_INVALID', 403)
      await validPortalSession(tx, claim.authSessionId, file.userId, now)
      await enabledWorker(tx, workerId)
      const target = this.control.getDownloadEndpoint(workerId)
      if (!target || target.instanceId !== instanceId) throw failure('WORKER_UNAVAILABLE', 503)
      if ('token' in input) {
        if (claim.consumedAt !== null || Date.parse(claim.expiresAt) <= Date.parse(now))
          throw failure('DOWNLOAD_CLAIM_INVALID', 403)
        await tx
          .update(downloadClaims)
          .set({ consumedAt: now, workerInstanceId: instanceId })
          .where(eq(downloadClaims.id, claim.id))
        await tx.insert(auditEvents).values({
          id: createPublicId(),
          actorUserId: file.userId,
          action: 'session.download.consume',
          targetType: 'download',
          targetId: file.id,
          result: 'SUCCEEDED',
          metadata: { sessionId: file.sessionId },
        })
      } else if (claim.consumedAt === null || claim.workerInstanceId !== instanceId)
        throw failure('DOWNLOAD_CLAIM_INVALID', 403)
      return {
        claimId: claim.id,
        downloadId: file.id,
        sessionId: file.sessionId,
        expiresAt: new Date(file.expiresAt).toISOString(),
      }
    })
  }
}

async function clock(tx: Transaction): Promise<string> {
  const [row] = await tx.execute<{ now: string }>(sql`select clock_timestamp() as now`)
  return new Date(row!.now).toISOString()
}
async function validPortalSession(
  tx: Transaction,
  id: string,
  userId: string,
  now: string,
): Promise<void> {
  const [session] = await tx
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(
      and(
        eq(authSessions.id, id),
        eq(authSessions.userId, userId),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, now),
      ),
    )
    .for('share')
  if (!session) throw failure('DOWNLOAD_CLAIM_INVALID', 403)
}
async function enabledWorker(tx: Transaction, workerId: string): Promise<void> {
  const [worker] = await tx
    .select({ id: workers.id })
    .from(workers)
    .where(
      and(
        eq(workers.id, workerId),
        isNull(workers.deletedAt),
        isNull(workers.disabledAt),
        ne(workers.status, 'DISABLED'),
      ),
    )
  if (!worker) throw failure('WORKER_UNAVAILABLE', 503)
}
function available(
  file: typeof sessionDownloads.$inferSelect | undefined,
  now: string,
): asserts file is typeof sessionDownloads.$inferSelect {
  if (!file) throw failure('NOT_FOUND', 404)
  if (file.status !== 'AVAILABLE' || Date.parse(file.expiresAt) <= Date.parse(now))
    throw failure('DOWNLOAD_UNAVAILABLE', 409)
}
function metadata(file: typeof sessionDownloads.$inferSelect): RetainedDownload {
  return {
    id: file.id,
    sessionId: file.sessionId,
    displayName: file.displayName,
    size: file.size,
    status: file.status,
    completedAt: new Date(file.completedAt).toISOString(),
    expiresAt: new Date(file.expiresAt).toISOString(),
    sessionEndedAt:
      file.sessionEndedAt === null ? null : new Date(file.sessionEndedAt).toISOString(),
    claimedAt: file.claimedAt === null ? null : new Date(file.claimedAt).toISOString(),
  }
}
function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
function failure(code: string, statusCode: number): BrowShareError {
  return new BrowShareError({
    code,
    statusCode,
    message: 'The download is not available for this request.',
  })
}
