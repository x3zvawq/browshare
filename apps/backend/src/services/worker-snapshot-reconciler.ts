import { isStorageBlockReason } from '@browshare/contracts'
import { recordProfileRuntimeFailure } from './profile-runtime-recovery.js'
import { createPublicId } from '@browshare/common'
import type { WorkerRuntimeSnapshot, WorkerSnapshotAcceptedMessage } from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  profileRuntimeOutbox,
  profiles,
  reservations,
  sessionEvents,
  tabSessions,
  workers,
  viewerTickets,
} from '@browshare/database/schema'
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { appendSessionEvent } from './session-events.js'

const ACTIVE_PROFILE_STATES = new Set(['STARTING', 'RUNNING', 'MAINTAINING', 'STOPPING'])
const WORKER_SESSION_STATES = new Set([
  'CREATING',
  'READY',
  'CONNECTED',
  'SUSPENDED',
  'DISCONNECTED',
  'CLOSING',
])
const TERMINAL_SESSION_STATES = new Set(['CLOSED', 'FAILED'])
const LEASE_EXPIRY_GRACE_MILLISECONDS = 60_000

export type WorkerReconciliationPlan = Pick<
  WorkerSnapshotAcceptedMessage['payload'],
  'closeSessions' | 'stopProfiles' | 'resnapshotRequired' | 'closedSessionIds'
>

export class WorkerSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerSnapshotValidationError'
  }
}

export class WorkerSnapshotReconciler {
  readonly #connection: DatabaseConnection

  constructor(connection: DatabaseConnection) {
    this.#connection = connection
  }

  async reconcile(
    workerId: string,
    snapshot: WorkerRuntimeSnapshot,
  ): Promise<WorkerReconciliationPlan> {
    validateRuntimeSnapshot(snapshot)
    const profileIds = snapshot.profiles.map((fact) => fact.profileId)
    const sessionIds = [...snapshot.sessions, ...(snapshot.closedSessions ?? [])].map(
      (fact) => fact.sessionId,
    )
    const profileFacts = new Map(snapshot.profiles.map((fact) => [fact.profileId, fact]))
    const sessionFacts = new Map(snapshot.sessions.map((fact) => [fact.sessionId, fact]))
    const closedFacts = new Map(
      (snapshot.closedSessions ?? []).map((fact) => [fact.sessionId, fact]),
    )

    return this.#connection.db.transaction(async (transaction) => {
      const [workerProfiles, workerSessions, referencedProfiles, referencedSessions] =
        await Promise.all([
          transaction
            .select({
              id: profiles.id,
              workerId: profiles.workerId,
              runtimeState: profiles.runtimeState,
              runtimeGeneration: profiles.runtimeGeneration,
              runtimeId: profiles.runtimeId,
              runtimeRouteVersion: profiles.runtimeRouteVersion,
              runtimeProxyHealth: profiles.runtimeProxyHealth,
              runtimeWorkerInstanceId: profiles.runtimeWorkerInstanceId,
              runtimeDesiredState: profiles.runtimeDesiredState,
              runtimeObservedAt: profiles.runtimeObservedAt,
              runtimeErrorCode: profiles.runtimeErrorCode,
              runtimeErrorSummary: profiles.runtimeErrorSummary,
              deletedAt: profiles.deletedAt,
              deleteRequestedAt: profiles.deleteRequestedAt,
            })
            .from(profiles)
            .where(and(eq(profiles.workerId, workerId), isNull(profiles.deletedAt)))
            .for('update'),
          transaction
            .select({
              id: tabSessions.id,
              profileId: tabSessions.profileId,
              workerId: tabSessions.workerId,
              status: tabSessions.status,
              closeReason: tabSessions.closeReason,
              tabId: tabSessions.tabId,
              targetId: tabSessions.targetId,
              viewerGeneration: tabSessions.viewerGeneration,
              leaseExpiresAt: tabSessions.leaseExpiresAt,
              runtimeId: tabSessions.runtimeId,
              profileGeneration: tabSessions.profileGeneration,
              workerInstanceId: tabSessions.workerInstanceId,
              runtimeObservedAt: tabSessions.runtimeObservedAt,
              pageScriptVersionId: tabSessions.pageScriptVersionId,
            })
            .from(tabSessions)
            .where(eq(tabSessions.workerId, workerId))
            .orderBy(asc(tabSessions.id))
            .for('update'),
          profileIds.length === 0
            ? Promise.resolve([])
            : transaction
                .select({
                  id: profiles.id,
                  workerId: profiles.workerId,
                  runtimeState: profiles.runtimeState,
                  runtimeGeneration: profiles.runtimeGeneration,
                  runtimeId: profiles.runtimeId,
                  runtimeRouteVersion: profiles.runtimeRouteVersion,
                  runtimeProxyHealth: profiles.runtimeProxyHealth,
                  runtimeWorkerInstanceId: profiles.runtimeWorkerInstanceId,
                  runtimeDesiredState: profiles.runtimeDesiredState,
                  runtimeObservedAt: profiles.runtimeObservedAt,
                  runtimeErrorCode: profiles.runtimeErrorCode,
                  runtimeErrorSummary: profiles.runtimeErrorSummary,
                  deletedAt: profiles.deletedAt,
                  deleteRequestedAt: profiles.deleteRequestedAt,
                })
                .from(profiles)
                .where(inArray(profiles.id, profileIds)),
          sessionIds.length === 0
            ? Promise.resolve([])
            : transaction
                .select({
                  id: tabSessions.id,
                  profileId: tabSessions.profileId,
                  workerId: tabSessions.workerId,
                  status: tabSessions.status,
                  closeReason: tabSessions.closeReason,
                  tabId: tabSessions.tabId,
                  targetId: tabSessions.targetId,
                  viewerGeneration: tabSessions.viewerGeneration,
                  leaseExpiresAt: tabSessions.leaseExpiresAt,
                  runtimeId: tabSessions.runtimeId,
                  profileGeneration: tabSessions.profileGeneration,
                  workerInstanceId: tabSessions.workerInstanceId,
                  runtimeObservedAt: tabSessions.runtimeObservedAt,
                  pageScriptVersionId: tabSessions.pageScriptVersionId,
                })
                .from(tabSessions)
                .where(inArray(tabSessions.id, sessionIds)),
        ])

      // workerSessions holds ordered row locks. The first-failure event is also
      // the durable deduplication marker across repeated snapshots and reconnects.
      const ownedSessions = new Map(workerSessions.map((session) => [session.id, session]))
      for (const fact of [...snapshot.sessions, ...(snapshot.closedSessions ?? [])]) {
        const error = fact.pageScriptError
        const session = ownedSessions.get(fact.sessionId)
        if (
          error === undefined ||
          session === undefined ||
          session.profileId !== fact.profileId ||
          session.runtimeId !== fact.runtimeId ||
          session.profileGeneration !== fact.profileGeneration ||
          session.workerInstanceId !== snapshot.instanceId ||
          (session.tabId !== null && session.tabId !== fact.tabId) ||
          (session.targetId !== null && session.targetId !== fact.targetId)
        )
          continue
        if (session.pageScriptVersionId !== error.versionId)
          throw new WorkerSnapshotValidationError(
            'Page Script error version does not match the Session.',
          )
        const [recorded] = await transaction
          .select({ id: sessionEvents.id })
          .from(sessionEvents)
          .where(
            and(
              eq(sessionEvents.sessionId, session.id),
              eq(sessionEvents.eventType, 'page_script.failed'),
            ),
          )
          .limit(1)
        if (recorded !== undefined) continue
        const summary = {
          code: 'PAGE_SCRIPT_FAILED',
          versionId: session.pageScriptVersionId,
          occurredAt: error.occurredAt,
          profileId: session.profileId,
          workerId,
        }
        await appendSessionEvent(transaction, session.id, 'page_script.failed', summary)
        await transaction.insert(auditEvents).values({
          id: createPublicId(),
          actorUserId: null,
          action: 'page_script.failed',
          targetType: 'session',
          targetId: session.id,
          result: 'FAILED',
          metadata: summary,
          occurredAt: error.occurredAt,
        })
      }

      const pending = await transaction
        .select()
        .from(profileRuntimeOutbox)
        .where(eq(profileRuntimeOutbox.workerId, workerId))
      const pendingByProfile = new Map(pending.map((operation) => [operation.profileId, operation]))
      const observedAt = snapshot.observedAt
      const pendingReservations = await transaction
        .select()
        .from(reservations)
        .where(and(eq(reservations.workerId, workerId), eq(reservations.status, 'ACTIVE')))
      const reservationBySession = new Map(
        pendingReservations.map((reservation) => [reservation.sessionId, reservation]),
      )
      const isOlderSessionObservation = (session: (typeof workerSessions)[number]) =>
        session.workerInstanceId === snapshot.instanceId &&
        session.runtimeObservedAt !== null &&
        Date.parse(observedAt) <= Date.parse(session.runtimeObservedAt)
      for (const profile of workerProfiles) {
        // Compare observations from the same Worker clock, not the Backend receive time.
        if (
          profile.runtimeWorkerInstanceId === snapshot.instanceId &&
          profile.runtimeObservedAt !== null &&
          Date.parse(observedAt) <= Date.parse(profile.runtimeObservedAt)
        )
          continue
        const fact = profileFacts.get(profile.id)
        const matching =
          fact !== undefined &&
          fact.runtimeId === profile.runtimeId &&
          fact.generation === profile.runtimeGeneration &&
          profile.runtimeWorkerInstanceId === snapshot.instanceId
        const operation = pendingByProfile.get(profile.id)
        if (profile.runtimeDesiredState === 'STOPPED') {
          if (
            fact === undefined &&
            profile.runtimeState !== 'STOPPED' &&
            profile.deleteRequestedAt === null &&
            !(operation !== undefined && Date.parse(operation.expiresAt) > Date.now())
          ) {
            await transaction
              .update(profiles)
              .set({
                runtimeState: 'STOPPED',
                runtimeRouteVersion: null,
                runtimeProxyHealth: null,
                runtimeErrorCode: null,
                runtimeErrorSummary: null,
                runtimeObservedAt: observedAt,
                updatedAt: sql`now()`,
              })
              .where(eq(profiles.id, profile.id))
            profile.runtimeState = 'STOPPED'
          }
        } else if (matching) {
          if (
            profile.runtimeRouteVersion !== null &&
            fact.routeVersion !== profile.runtimeRouteVersion
          )
            throw new WorkerSnapshotValidationError(
              'Profile Runtime route version changed within its immutable identity',
            )
          const state =
            fact.state === 'RUNNING' && profile.runtimeState === 'MAINTAINING'
              ? 'MAINTAINING'
              : fact.state
          if (state === 'STARTING' && profile.runtimeState === 'RUNNING') continue
          await transaction
            .update(profiles)
            .set({
              runtimeState: state,
              ...(fact.state === 'RUNNING' ? { dataInitialized: true } : {}),
              runtimeRouteVersion: fact.routeVersion ?? null,
              ...((fact.proxyHealth?.checkedAt ?? '') >=
              (profile.runtimeProxyHealth?.checkedAt ?? '')
                ? { runtimeProxyHealth: fact.proxyHealth ?? null }
                : {}),
              runtimeObservedAt: observedAt,
              ...(state === 'RUNNING'
                ? {
                    runtimeHealthySince: sql`coalesce(${profiles.runtimeHealthySince}, clock_timestamp())`,
                  }
                : {}),
              runtimeErrorCode:
                state === 'ERROR' ? (profile.runtimeErrorCode ?? 'PROFILE_CHROME_EXITED') : null,
              runtimeErrorSummary:
                state === 'ERROR'
                  ? (profile.runtimeErrorSummary ??
                    'The Profile Chrome process exited unexpectedly.')
                  : null,
              updatedAt: sql`now()`,
            })
            .where(eq(profiles.id, profile.id))
          if (state === 'ERROR')
            await recordProfileRuntimeFailure(transaction, profile.id, profile.runtimeGeneration)
          profile.runtimeState = state
        } else if (
          ACTIVE_PROFILE_STATES.has(profile.runtimeState) &&
          !isStorageBlockReason(profile.runtimeErrorCode) &&
          profile.runtimeErrorCode !== 'PROFILE_DATA_MISSING' &&
          !(
            operation !== undefined &&
            Date.parse(operation.expiresAt) > Date.now() &&
            profile.runtimeWorkerInstanceId === snapshot.instanceId
          )
        ) {
          await transaction
            .update(profiles)
            .set({
              runtimeState: 'ERROR',
              runtimeObservedAt: observedAt,
              runtimeErrorCode: 'WORKER_RUNTIME_MISSING',
              runtimeErrorSummary: 'The Worker no longer reports this Profile Runtime.',
              updatedAt: sql`now()`,
            })
            .where(eq(profiles.id, profile.id))
          await recordProfileRuntimeFailure(transaction, profile.id, profile.runtimeGeneration)
          profile.runtimeState = 'ERROR'
        }
      }

      const missingSessions = workerSessions.filter((session) => {
        if (
          !WORKER_SESSION_STATES.has(session.status) ||
          sessionFacts.has(session.id) ||
          closedFacts.has(session.id) ||
          isOlderSessionObservation(session)
        )
          return false
        const reservation = reservationBySession.get(session.id)
        // Reservation expiry owns its timeout reason and quota release. A missing Tab while
        // its creation is pending is not a runtime loss unless the Worker process changed.
        return !(
          session.status === 'CREATING' &&
          reservation !== undefined &&
          session.workerInstanceId === snapshot.instanceId
        )
      })
      const missingSessionIds = missingSessions
        .filter((session) => session.status !== 'CLOSING')
        .map((session) => session.id)
      if (missingSessionIds.length > 0) {
        await transaction
          .update(tabSessions)
          .set({
            status: 'FAILED',
            failureCode: 'WORKER_STATE_MISSING_AFTER_RECONNECT',
            failureSummary: 'The Worker did not report this active Tab Session after reconnecting.',
            closedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(inArray(tabSessions.id, missingSessionIds))
        await transaction
          .update(reservations)
          .set({
            status: 'RELEASED',
            releasedAt: sql`now()`,
            releaseReason: 'WORKER_STATE_MISSING_AFTER_RECONNECT',
            updatedAt: sql`now()`,
          })
          .where(
            and(
              inArray(reservations.sessionId, missingSessionIds),
              or(eq(reservations.status, 'ACTIVE'), eq(reservations.status, 'CONSUMED')),
            ),
          )
      }
      for (const session of missingSessions) {
        if (session.status === 'CLOSING') {
          await transaction
            .update(tabSessions)
            .set({ status: 'CLOSED', closedAt: sql`now()`, updatedAt: sql`now()` })
            .where(eq(tabSessions.id, session.id))
          await transaction
            .update(reservations)
            .set({
              status: 'RELEASED',
              releasedAt: sql`now()`,
              releaseReason: 'SESSION_CLOSED',
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(reservations.sessionId, session.id),
                inArray(reservations.status, ['ACTIVE', 'CONSUMED']),
              ),
            )
        }
        await appendSessionEvent(
          transaction,
          session.id,
          session.status === 'CLOSING' ? 'session.closed' : 'session.failed',
          session.status === 'CLOSING' ? {} : { code: 'WORKER_STATE_MISSING_AFTER_RECONNECT' },
        )
      }

      const referencedProfileMap = new Map(
        [...referencedProfiles, ...workerProfiles].map((profile) => [profile.id, profile]),
      )
      const referencedSessionMap = new Map(
        referencedSessions.map((session) => [session.id, session]),
      )
      const stopProfiles: WorkerReconciliationPlan['stopProfiles'] = []
      const closeSessions: WorkerReconciliationPlan['closeSessions'] = []
      const closedSessionIds: string[] = []

      for (const fact of closedFacts.values()) {
        const session = referencedSessionMap.get(fact.sessionId)
        if (!session) {
          closedSessionIds.push(fact.sessionId)
          continue
        }
        if (
          session.workerId !== workerId ||
          session.profileId !== fact.profileId ||
          session.runtimeId !== fact.runtimeId ||
          session.profileGeneration !== fact.profileGeneration ||
          session.workerInstanceId !== snapshot.instanceId ||
          (session.tabId !== null && session.tabId !== fact.tabId) ||
          (session.targetId !== null && session.targetId !== fact.targetId)
        )
          throw new WorkerSnapshotValidationError(
            'Closed Session identity does not match its reservation.',
          )
        if (TERMINAL_SESSION_STATES.has(session.status)) {
          closedSessionIds.push(fact.sessionId)
          continue
        }
        if (isOlderSessionObservation(session)) continue
        const reason = session.closeReason ?? fact.reason
        const runtimeFailed =
          session.closeReason === null &&
          ['PROFILE_CHROME_EXITED', 'REMOTE_TAB_FAILED'].includes(fact.reason)
        await transaction
          .update(tabSessions)
          .set({
            status: runtimeFailed ? 'FAILED' : 'CLOSED',
            ...(runtimeFailed
              ? { failureCode: fact.reason, failureSummary: 'The browser runtime failed.' }
              : {}),
            closedAt: fact.closedAt,
            closingAt: sql`coalesce(${tabSessions.closingAt}, ${fact.closedAt}::timestamptz)`,
            closeReason: reason,
            tabId: fact.tabId,
            targetId: fact.targetId,
            runtimeObservedAt: observedAt,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(tabSessions.id, session.id))
        await transaction
          .update(reservations)
          .set({
            status: 'RELEASED',
            releasedAt: fact.closedAt,
            releaseReason: reason,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(reservations.sessionId, session.id),
              inArray(reservations.status, ['ACTIVE', 'CONSUMED']),
            ),
          )
        await transaction
          .update(viewerTickets)
          .set({
            status: 'REVOKED',
            revokedAt: fact.closedAt,
            revokeReason: reason,
          })
          .where(and(eq(viewerTickets.sessionId, session.id), eq(viewerTickets.status, 'ACTIVE')))
        await appendSessionEvent(
          transaction,
          session.id,
          runtimeFailed ? 'session.failed' : 'session.closed',
          { reason },
        )
        await transaction.insert(auditEvents).values({
          id: createPublicId(),
          action: runtimeFailed ? 'session.failed' : 'session.closed',
          targetType: 'session',
          targetId: session.id,
          result: 'SUCCEEDED',
          metadata: { reason, workerId },
        })
        closedSessionIds.push(session.id)
      }

      for (const fact of snapshot.profiles) {
        const profile = referencedProfileMap.get(fact.profileId)
        if (profile === undefined || profile.workerId !== workerId || profile.deletedAt !== null) {
          stopProfiles.push({ ...runtimeIdentity(fact), reason: 'BACKEND_PROFILE_MISSING' })
        } else if (
          profile.runtimeGeneration !== fact.generation ||
          profile.runtimeId !== fact.runtimeId ||
          profile.runtimeWorkerInstanceId !== snapshot.instanceId
        ) {
          stopProfiles.push({ ...runtimeIdentity(fact), reason: 'GENERATION_MISMATCH' })
        } else if (profile.runtimeDesiredState === 'STOPPED') {
          stopProfiles.push({ ...runtimeIdentity(fact), reason: 'BACKEND_PROFILE_STOPPED' })
        }
      }

      const now = Date.now()
      for (const fact of snapshot.sessions) {
        const session = referencedSessionMap.get(fact.sessionId)
        if (session === undefined) {
          closeSessions.push({ sessionId: fact.sessionId, reason: 'BACKEND_SESSION_MISSING' })
          continue
        }
        if (TERMINAL_SESSION_STATES.has(session.status)) {
          closeSessions.push({ sessionId: fact.sessionId, reason: 'BACKEND_SESSION_TERMINAL' })
          continue
        }
        if (session.status === 'CLOSING') {
          closeSessions.push({ sessionId: fact.sessionId, reason: 'BACKEND_SESSION_CLOSING' })
          continue
        }
        if (isOlderSessionObservation(session)) continue
        const profile = referencedProfileMap.get(fact.profileId)
        const mappingConflicts =
          session.workerId !== workerId ||
          session.profileId !== fact.profileId ||
          !WORKER_SESSION_STATES.has(session.status) ||
          fact.viewerGeneration > session.viewerGeneration ||
          (session.tabId !== null && session.tabId !== fact.tabId) ||
          (session.targetId !== null && session.targetId !== fact.targetId) ||
          profile === undefined ||
          profile.workerId !== workerId ||
          profile.deletedAt !== null ||
          profile.runtimeGeneration !== fact.profileGeneration ||
          profile.runtimeId !== fact.runtimeId ||
          profile.runtimeWorkerInstanceId !== snapshot.instanceId ||
          session.runtimeId !== fact.runtimeId ||
          session.profileGeneration !== fact.profileGeneration ||
          session.workerInstanceId !== snapshot.instanceId ||
          !ACTIVE_PROFILE_STATES.has(profile.runtimeState)
        if (mappingConflicts) {
          closeSessions.push({ sessionId: fact.sessionId, reason: 'MAPPING_CONFLICT' })
          continue
        }
        // The Backend persists a new authorized generation before Worker preparation. A snapshot
        // from the previous Viewer is still the same Tab, but cannot overwrite the new intent.
        if (fact.viewerGeneration < session.viewerGeneration) continue
        if (!isReconciliableSessionTransition(session.status, fact.status)) {
          closeSessions.push({ sessionId: fact.sessionId, reason: 'MAPPING_CONFLICT' })
          continue
        }
        const reservation = reservationBySession.get(session.id)
        if (
          session.status === 'CREATING' &&
          (reservation === undefined || Date.parse(reservation.expiresAt) <= Date.now())
        ) {
          closeSessions.push({ sessionId: fact.sessionId, reason: 'MAPPING_CONFLICT' })
          continue
        }
        const leaseExpiries = [
          session.leaseExpiresAt,
          parseOptionalDate(fact.leaseExpiresAt),
        ].filter((value): value is string | Date => value !== null)
        if (
          leaseExpiries.some(
            (value) => new Date(value).getTime() + LEASE_EXPIRY_GRACE_MILLISECONDS < now,
          )
        ) {
          closeSessions.push({ sessionId: fact.sessionId, reason: 'LEASE_EXPIRED' })
          continue
        }
        await transaction
          .update(tabSessions)
          .set({
            status: fact.status,
            tabId: fact.tabId,
            targetId: fact.targetId,
            remoteTitle: fact.remoteTitle,
            ...(fact.recycling === undefined ? {} : { recycling: fact.recycling }),
            ...(fact.lastInputAt === undefined ? {} : { lastInputAt: fact.lastInputAt }),
            ...(fact.lastFrameChangedAt === undefined
              ? {}
              : { lastFrameChangedAt: fact.lastFrameChangedAt }),
            runtimeObservedAt: observedAt,
            updatedAt: sql`now()`,
            ...(fact.status === 'CONNECTED' &&
            session.status !== 'CONNECTED' &&
            session.status !== 'SUSPENDED'
              ? { viewerConnectedAt: observedAt }
              : {}),
            ...(fact.status === 'DISCONNECTED' && session.status !== 'DISCONNECTED'
              ? { viewerDisconnectedAt: observedAt }
              : {}),
          })
          .where(eq(tabSessions.id, fact.sessionId))
        if (
          session.status === 'CREATING' &&
          ['READY', 'CONNECTED', 'SUSPENDED', 'DISCONNECTED'].includes(fact.status)
        ) {
          await transaction
            .update(reservations)
            .set({ status: 'CONSUMED', consumedAt: sql`now()`, updatedAt: sql`now()` })
            .where(and(eq(reservations.sessionId, session.id), eq(reservations.status, 'ACTIVE')))
        }
        if (session.status !== fact.status)
          await appendSessionEvent(
            transaction,
            session.id,
            `session.${fact.status.toLowerCase()}`,
            {},
          )
      }

      await transaction
        .update(workers)
        .set({
          runtimeSnapshot: snapshot,
          lastSnapshotAt: sql`now()`,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(workers.id, workerId))

      // Keep maintenance intent through failures and Backend restarts until a complete snapshot
      // proves there is no Tab, and an expired create can no longer arrive behind that snapshot.
      const completedMaintenance = await transaction
        .select({ session: tabSessions, reservation: reservations })
        .from(tabSessions)
        .innerJoin(reservations, eq(reservations.sessionId, tabSessions.id))
        .where(
          and(
            eq(tabSessions.workerId, workerId),
            eq(tabSessions.kind, 'MAINTENANCE'),
            isNull(tabSessions.maintenanceReleasedAt),
            inArray(tabSessions.status, ['CLOSED', 'FAILED']),
          ),
        )
      for (const { session, reservation } of completedMaintenance) {
        if (sessionFacts.has(session.id)) continue
        if (
          session.runtimeId !== null &&
          session.status !== 'CLOSED' &&
          Date.parse(observedAt) <= Date.parse(reservation.expiresAt)
        )
          continue
        await transaction
          .update(tabSessions)
          .set({ maintenanceReleasedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` })
          .where(eq(tabSessions.id, session.id))
        await transaction
          .update(profiles)
          .set({ runtimeState: 'RUNNING', updatedAt: sql`clock_timestamp()` })
          .where(and(eq(profiles.id, session.profileId), eq(profiles.runtimeState, 'MAINTAINING')))
        await appendSessionEvent(transaction, session.id, 'session.maintenance.released', {})
      }

      return {
        closeSessions,
        stopProfiles,
        resnapshotRequired: closeSessions.length > 0 || stopProfiles.length > 0,
        ...(snapshot.closedSessions === undefined ? {} : { closedSessionIds }),
      }
    })
  }
}

function validateRuntimeSnapshot(snapshot: WorkerRuntimeSnapshot): void {
  assertUnique(
    snapshot.profiles.map((fact) => fact.profileId),
    'Profile ID',
  )
  assertUnique(
    snapshot.profiles.map((fact) => fact.runtimeId),
    'Profile Runtime ID',
  )
  assertUnique(
    [...snapshot.sessions, ...(snapshot.closedSessions ?? [])].map((fact) => fact.sessionId),
    'Session ID',
  )
  assertUnique(
    snapshot.sessions.flatMap((fact) => (fact.tabId === null ? [] : [fact.tabId])),
    'Chrome tab ID',
  )
  assertUnique(
    snapshot.sessions.flatMap((fact) => (fact.targetId === null ? [] : [fact.targetId])),
    'CDP target ID',
  )
  const profilesById = new Map(snapshot.profiles.map((fact) => [fact.profileId, fact]))
  for (const session of snapshot.sessions) {
    const profile = profilesById.get(session.profileId)
    if (
      profile === undefined ||
      profile.runtimeId !== session.runtimeId ||
      profile.generation !== session.profileGeneration
    ) {
      throw new WorkerSnapshotValidationError(
        'Every Session fact must reference the matching Profile Runtime generation.',
      )
    }
  }
}

function assertUnique(values: readonly (string | number)[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new WorkerSnapshotValidationError(`${label} values must be unique within a snapshot.`)
  }
}

function runtimeIdentity(fact: WorkerRuntimeSnapshot['profiles'][number]) {
  return {
    profileId: fact.profileId,
    runtimeId: fact.runtimeId,
    generation: fact.generation,
  }
}

function parseOptionalDate(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

function isReconciliableSessionTransition(
  stored: string,
  observed: WorkerRuntimeSnapshot['sessions'][number]['status'],
): boolean {
  switch (stored) {
    case 'CREATING':
      return true
    case 'READY':
      return observed !== 'CREATING'
    case 'CONNECTED':
      return observed === 'CONNECTED' || observed === 'SUSPENDED' || observed === 'DISCONNECTED'
    case 'SUSPENDED':
      return observed === 'CONNECTED' || observed === 'SUSPENDED' || observed === 'DISCONNECTED'
    case 'DISCONNECTED':
      return observed === 'CONNECTED' || observed === 'SUSPENDED' || observed === 'DISCONNECTED'
    default:
      return false
  }
}
