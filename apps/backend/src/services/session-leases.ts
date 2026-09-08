import type { DatabaseConnection } from '@browshare/database'
import { profiles, tabSessions, users, workers } from '@browshare/database/schema'
import type { WorkerRuntimeSnapshot, WorkerSnapshotAcceptedMessage } from '@browshare/contracts'
import { eq, sql } from 'drizzle-orm'
import { authorized } from './gateways.js'

type Grant = NonNullable<WorkerSnapshotAcceptedMessage['payload']['leases']>[number]
const CONNECTABLE = ['READY', 'CONNECTED', 'SUSPENDED', 'DISCONNECTED']
const DURATION = 600_000
const RENEW_BEFORE = 300_000

/** A grant is committed authorization. Delivery is recovered from the next actual Worker snapshot. */
export class SessionLeaseService {
  constructor(private readonly connection: DatabaseConnection) {}

  async grant(
    workerId: string,
    snapshot: WorkerRuntimeSnapshot,
    excluded: ReadonlySet<string>,
  ): Promise<Grant[]> {
    const grants: Grant[] = []
    for (const fact of snapshot.sessions) {
      if (excluded.has(fact.sessionId) || !CONNECTABLE.includes(fact.status)) continue
      const grant = await this.connection.db.transaction(async (tx) => {
        // Match Viewer preparation: policy configuration -> Profile -> User -> Session.
        await tx.execute(sql`select pg_advisory_xact_lock_shared(28691, 1)`)
        const [profile] = await tx
          .select()
          .from(profiles)
          .where(eq(profiles.id, fact.profileId))
          .for('update')
        if (
          !profile ||
          profile.workerId !== workerId ||
          profile.runtimeId !== fact.runtimeId ||
          profile.runtimeGeneration !== fact.profileGeneration ||
          profile.runtimeWorkerInstanceId !== snapshot.instanceId ||
          profile.runtimeDesiredState === 'STOPPED'
        )
          return
        const [owner] = await tx
          .select({ userId: tabSessions.userId })
          .from(tabSessions)
          .where(eq(tabSessions.id, fact.sessionId))
        if (!owner) return
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, owner.userId))
          .for('update')
        const [session] = await tx
          .select()
          .from(tabSessions)
          .where(eq(tabSessions.id, fact.sessionId))
          .for('update')
        if (
          !session ||
          !CONNECTABLE.includes(session.status) ||
          session.workerId !== workerId ||
          session.profileId !== fact.profileId ||
          session.runtimeId !== fact.runtimeId ||
          session.profileGeneration !== fact.profileGeneration ||
          session.workerInstanceId !== snapshot.instanceId ||
          session.tabId === null ||
          session.targetId === null ||
          session.tabId !== fact.tabId ||
          session.targetId !== fact.targetId ||
          session.viewerGeneration !== fact.viewerGeneration
        )
          return
        const [worker] = await tx
          .select({ status: workers.status, disabledAt: workers.disabledAt })
          .from(workers)
          .where(eq(workers.id, workerId))
        if (
          !worker ||
          worker.disabledAt !== null ||
          !['ONLINE', 'OFFLINE', 'DRAINING'].includes(worker.status) ||
          !(await authorized(tx, session.userId, session.profileId, session.kind))
        )
          return
        const [clock] = await tx.execute<{ now: string }>(sql`select clock_timestamp() as now`)
        const now = Date.parse(clock!.now),
          saved = Date.parse(session.leaseExpiresAt ?? ''),
          actual = Date.parse(fact.leaseExpiresAt ?? '')
        // Neither a late reconnect nor a DB-only grant may resurrect an expired Worker lease.
        if (
          !Number.isFinite(saved) ||
          !Number.isFinite(actual) ||
          saved <= now ||
          actual <= now ||
          actual > saved
        )
          return
        const expiresAt = new Date(
          saved - now <= RENEW_BEFORE ? now + DURATION : saved,
        ).toISOString()
        if (Date.parse(expiresAt) !== saved)
          await tx
            .update(tabSessions)
            .set({ leaseExpiresAt: expiresAt })
            .where(eq(tabSessions.id, session.id))
        if (Date.parse(expiresAt) <= actual) return
        return {
          sessionId: session.id,
          profileId: session.profileId,
          runtimeId: fact.runtimeId,
          profileGeneration: fact.profileGeneration,
          tabId: session.tabId,
          targetId: session.targetId,
          expiresAt,
        }
      })
      if (grant) grants.push(grant)
    }
    return grants
  }
}
