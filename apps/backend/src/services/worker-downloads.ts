import { isPublicId } from '@browshare/common'
import {
  RetainedDownloadSchema,
  WORKER_DOWNLOAD_BATCH_SIZE,
  type RetainedDownload,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { downloadClaims, sessionDownloads, tabSessions } from '@browshare/database/schema'
import { asc, eq, inArray } from 'drizzle-orm'
import { Value } from 'typebox/value'

export class WorkerDownloadValidationError extends Error {
  constructor() {
    super('Worker download metadata is inconsistent with its owner or prior state')
    this.name = 'WorkerDownloadValidationError'
  }
}

export class WorkerDownloadReconciler {
  constructor(private readonly connection: DatabaseConnection) {}

  async reconcile(workerId: string, files: readonly RetainedDownload[]): Promise<string[]> {
    if (
      !isPublicId(workerId) ||
      files.length === 0 ||
      files.length > WORKER_DOWNLOAD_BATCH_SIZE ||
      new Set(files.map((file) => file.id)).size !== files.length
    )
      throw new WorkerDownloadValidationError()
    for (const file of files) validateFile(file)

    return this.connection.db.transaction(async (tx) => {
      // Lock Session owners in a stable order; all ownership comes from this relation, not the report.
      const owners = await tx
        .select()
        .from(tabSessions)
        .where(inArray(tabSessions.id, [...new Set(files.map((file) => file.sessionId))]))
        .orderBy(asc(tabSessions.id))
        .for('update')
      const sessions = new Map(owners.map((session) => [session.id, session]))
      const terminalIds: string[] = []
      for (const file of files) {
        const owner = sessions.get(file.sessionId)
        if (!owner || owner.workerId !== workerId) throw new WorkerDownloadValidationError()
        const values = {
          ...file,
          userId: owner.userId,
          profileId: owner.profileId,
          workerId,
        }
        await tx.insert(sessionDownloads).values(values).onConflictDoNothing()
        const [previous] = await tx
          .select()
          .from(sessionDownloads)
          .where(eq(sessionDownloads.id, file.id))
          .for('update')
        if (
          !previous ||
          previous.workerId !== workerId ||
          previous.sessionId !== file.sessionId ||
          previous.displayName !== file.displayName ||
          previous.size !== file.size ||
          Date.parse(previous.completedAt) !== Date.parse(file.completedAt)
        )
          throw new WorkerDownloadValidationError()
        if (
          previous.status !== 'AVAILABLE' &&
          file.status !== 'AVAILABLE' &&
          (previous.status !== file.status || time(previous.claimedAt) !== time(file.claimedAt))
        )
          throw new WorkerDownloadValidationError()
        const status = previous.status === 'AVAILABLE' ? file.status : previous.status
        const claimedAt = previous.claimedAt ?? file.claimedAt
        const expiresAt = new Date(
          Math.min(Date.parse(previous.expiresAt), Date.parse(file.expiresAt)),
        ).toISOString()
        const sessionEndedAt = earlier(previous.sessionEndedAt, file.sessionEndedAt)
        // Periodic replay of unchanged metadata must not rewrite every row every five seconds.
        if (
          status !== previous.status ||
          time(claimedAt) !== time(previous.claimedAt) ||
          time(expiresAt) !== time(previous.expiresAt) ||
          time(sessionEndedAt) !== time(previous.sessionEndedAt)
        )
          await tx
            .update(sessionDownloads)
            .set({
              status,
              claimedAt,
              expiresAt,
              sessionEndedAt,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(sessionDownloads.id, file.id))
        if (status !== 'AVAILABLE')
          await tx.delete(downloadClaims).where(eq(downloadClaims.downloadId, file.id))
        if (file.status !== 'AVAILABLE') terminalIds.push(file.id)
      }
      // Returning from transaction commits before the caller can acknowledge any terminal record.
      return terminalIds
    })
  }
}

function time(value: string | null): number | null {
  return value === null ? null : Date.parse(value)
}

function earlier(left: string | null, right: string | null): string | null {
  if (left === null) return right
  if (right === null) return left
  return new Date(Math.min(Date.parse(left), Date.parse(right))).toISOString()
}

function validateFile(file: RetainedDownload): void {
  if (
    !Value.Check(RetainedDownloadSchema, file) ||
    !isPublicId(file.id) ||
    !isPublicId(file.sessionId)
  )
    throw new WorkerDownloadValidationError()
  const completed = Date.parse(file.completedAt),
    expires = Date.parse(file.expiresAt)
  if (
    (file.status === 'CLAIMED') !== (file.claimedAt !== null) ||
    expires > completed + 30 * 60_000 ||
    (file.sessionEndedAt !== null && expires > Date.parse(file.sessionEndedAt) + 10 * 60_000)
  )
    throw new WorkerDownloadValidationError()
}
