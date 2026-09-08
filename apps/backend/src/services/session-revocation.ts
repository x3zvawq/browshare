import type { WorkerSessionCloseCommandMessage } from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { tabSessions } from '@browshare/database/schema'
import { and, asc, notInArray, type SQL } from 'drizzle-orm'
import { authorized } from './gateways.js'
import { queueSessionClose } from './session-closure.js'
import type { AuditContext } from './users.js'
type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]

/** Authorization changes hold the exclusive configuration lock before any entity locks. */
export async function revokeTabSessions(
  tx: Transaction,
  scope: SQL,
  reason: WorkerSessionCloseCommandMessage['payload']['reason'],
  context: AuditContext,
  recheckAccess = true,
): Promise<void> {
  const sessions = await tx
    .select()
    .from(tabSessions)
    .where(and(scope, notInArray(tabSessions.status, ['CLOSING', 'CLOSED', 'FAILED'])))
    .orderBy(asc(tabSessions.id))
    .for('update')
  const access = new Map<string, boolean>()
  for (const session of sessions) {
    if (recheckAccess) {
      const key = session.userId + ':' + session.profileId + ':' + session.kind
      if (!access.has(key))
        access.set(key, await authorized(tx, session.userId, session.profileId, session.kind))
      if (access.get(key)) continue
    }
    await queueSessionClose(tx, session, reason, context)
  }
}
