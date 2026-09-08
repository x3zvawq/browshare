import { createPublicId } from '@browshare/common'
import {
  encodeWorkerControlMessage,
  WORKER_CONTROL_PROTOCOL_MAJOR,
  WORKER_CONTROL_PROTOCOL_MINOR,
  type WorkerSessionCloseCommandMessage,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  reservations,
  sessionCloseOutbox,
  tabSessions,
  viewerTickets,
} from '@browshare/database/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AuditContext } from './users.js'
import { appendSessionEvent } from './session-events.js'
type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]

/** Caller owns the Session row lock; intent and outbox commit with the authorizing mutation. */
export async function queueSessionClose(
  tx: Transaction,
  session: typeof tabSessions.$inferSelect,
  reason: WorkerSessionCloseCommandMessage['payload']['reason'],
  context: AuditContext,
): Promise<void> {
  const sessionId = session.id
  if (['CLOSING', 'CLOSED', 'FAILED'].includes(session.status)) return
  const [reservation] = await tx
    .select()
    .from(reservations)
    .where(eq(reservations.sessionId, sessionId))
    .for('update')
  const immediatelyClosed = session.status === 'RESERVED' && session.runtimeId === null
  let commandId: string | undefined
  await tx
    .update(tabSessions)
    .set({
      status: immediatelyClosed ? 'CLOSED' : 'CLOSING',
      closingAt: sql`clock_timestamp()`,
      closeReason: reason,
      updatedAt: sql`clock_timestamp()`,
      ...(immediatelyClosed ? { closedAt: sql`clock_timestamp()` } : {}),
    })
    .where(eq(tabSessions.id, sessionId))
  await tx
    .update(viewerTickets)
    .set({
      status: 'REVOKED',
      revokedAt: sql`clock_timestamp()`,
      revokeReason: reason,
    })
    .where(and(eq(viewerTickets.sessionId, sessionId), eq(viewerTickets.status, 'ACTIVE')))
  await appendSessionEvent(tx, sessionId, 'session.closing', { reason })
  if (immediatelyClosed) {
    await releaseReservation(tx, sessionId, reason)
    await appendSessionEvent(tx, sessionId, 'session.closed', { reason })
  } else {
    if (
      session.runtimeId === null ||
      session.workerInstanceId === null ||
      session.profileGeneration === null ||
      !reservation
    )
      throw new Error('Active Session runtime identity or reservation is missing')
    const command: WorkerSessionCloseCommandMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'session.close',
      messageId: createPublicId(),
      correlationId: null,
      sentAt: Date.now(),
      payload: {
        workerId: session.workerId,
        instanceId: session.workerInstanceId,
        sessionId,
        profileId: session.profileId,
        runtimeId: session.runtimeId,
        profileGeneration: session.profileGeneration,
        creationExpiresAt: new Date(reservation.expiresAt).toISOString(),
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        reason,
      },
    }
    encodeWorkerControlMessage(command)
    await tx.insert(sessionCloseOutbox).values({
      id: command.messageId,
      sessionId,
      command,
      expiresAt: command.payload.expiresAt,
    })
    commandId = command.messageId
  }
  await tx.insert(auditEvents).values({
    id: createPublicId(),
    actorUserId: context.actorUserId,
    targetType: 'session',
    targetId: sessionId,
    action: 'session.close',
    result: 'SUCCEEDED',
    metadata: { reason, ...(commandId === undefined ? {} : { commandId }) },
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
  })
}

export async function releaseReservation(
  tx: Transaction,
  sessionId: string,
  reason: string,
): Promise<void> {
  await tx
    .update(reservations)
    .set({
      status: 'RELEASED',
      releasedAt: sql`clock_timestamp()`,
      releaseReason: reason,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(reservations.sessionId, sessionId),
        inArray(reservations.status, ['ACTIVE', 'CONSUMED']),
      ),
    )
}
