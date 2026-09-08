import { assertStorageAdmission } from './storage.js'
import { validateProfileContextVariables } from './profile-contexts.js'
import { readSessionTransferSettings, readSessionMediaSettings } from './system-settings.js'
import { appendSessionEvent } from './session-events.js'
import { BrowShareError, createPublicId, isPublicId } from '@browshare/common'
import { createHash, randomBytes } from 'node:crypto'
import {
  WorkerCapabilityReportSchema,
  SessionNavigationPolicySchema,
  SessionPageScriptSchema,
  encodeWorkerControlMessage,
  WORKER_CONTROL_PROTOCOL_MAJOR,
  WORKER_CONTROL_PROTOCOL_MINOR,
  type WorkerSessionCreateCommandMessage,
  type WorkerSessionRuntimeFact,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  profiles,
  reservations,
  tabSessions,
  users,
  workers,
  navigationPolicyVersions,
  pageScriptVersions,
  profilePublications,
  sessionCreateOutbox,
  userProfileContexts,
} from '@browshare/database/schema'
import { and, asc, count, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { Value } from 'typebox/value'

import { authorized } from './gateways.js'
import { queueSessionClose } from './session-closure.js'
import { persistProfileRuntimeOperation } from './profile-runtimes.js'
import type { WorkerControlServer } from './worker-control-server.js'
import { resolveSessionPolicy, type PolicyTransaction } from './session-policy-rules.js'
import type { WorkerControlStatus } from './workers.js'

const TERMINAL = ['CLOSED', 'FAILED'] as const
const PENDING = ['RESERVED', 'CREATING'] as const
const RESERVATION_MILLISECONDS = 120_000
const LEASE_MILLISECONDS = 600_000

type SessionRecord = typeof tabSessions.$inferSelect
type ReservationRecord = typeof reservations.$inferSelect

export interface ReservedSession {
  readonly session: SessionRecord
  readonly reservation: ReservationRecord
}

export interface SessionCreationInput {
  kind?: 'NORMAL' | 'MAINTENANCE'
  pageScriptVersionId?: string
  initialUrl: string
  gateway: { id: string; publicEndpoint: string }
}

export interface SessionReservationControl extends Pick<
  WorkerControlServer,
  'prepareProfileRuntime'
> {
  getWorkerControlStatus(workerId: string): WorkerControlStatus
}

/** Quota and authorization ownership. The Session command dispatcher consumes these reservations. */
export class SessionReservationService {
  #timer: NodeJS.Timeout | undefined
  #expiryRun: Promise<void> | undefined
  #closed = false

  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: SessionReservationControl,
    private readonly onError: (cause: unknown) => void,
  ) {}

  start(): void {
    if (this.#timer !== undefined || this.#closed) return
    this.#timer = setInterval(() => this.#scheduleExpiry(), 1000)
    this.#timer.unref()
    this.#scheduleExpiry()
  }

  stop(): void {
    this.#closed = true
    clearInterval(this.#timer)
  }

  async drain(): Promise<void> {
    await this.#expiryRun
  }

  async reserve(
    userId: string,
    profileId: string,
    requestId?: string,
    creation?: SessionCreationInput,
  ): Promise<ReservedSession> {
    assertId(userId)
    assertId(profileId)
    const maintenance = creation?.kind === 'MAINTENANCE'
    if (this.#closed) throw failure('SERVICE_CLOSED', 'Session scheduling is shutting down.', 503)
    return this.connection.db.transaction(async (tx) => {
      // Policy/group mutations hold the exclusive lock. Unrelated reservations can share it.
      // Entity order matches direct grants and Profile reconciliation: Profile, User, Worker.
      await tx.execute(sql`select pg_advisory_xact_lock_shared(28691, 1)`)
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, profileId))
        .for('update')
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
      if (!user || user.status !== 'ENABLED' || user.deletedAt !== null)
        throw failure('FORBIDDEN', 'The user cannot create a Session.', 403)
      if (
        !profile ||
        !(await authorized(tx, userId, profileId, maintenance ? 'MAINTENANCE' : 'NORMAL'))
      )
        throw failure('PROFILE_NOT_ACCESSIBLE', 'The Profile is not available to this user.', 404)
      const [maintainer] = await tx
        .select({ id: tabSessions.id })
        .from(tabSessions)
        .where(
          and(
            eq(tabSessions.profileId, profileId),
            eq(tabSessions.kind, 'MAINTENANCE'),
            isNull(tabSessions.maintenanceReleasedAt),
          ),
        )
        .limit(1)
      if (maintainer)
        throw failure('PROFILE_MAINTENANCE_ACTIVE', 'The Profile is reserved for maintenance.')
      const [worker] = await tx
        .select()
        .from(workers)
        .where(eq(workers.id, profile.workerId))
        .for('update')
      if (
        !worker ||
        worker.deletedAt !== null ||
        worker.status !== 'ONLINE' ||
        worker.disabledAt !== null
      )
        throw failure('WORKER_UNAVAILABLE', 'The Profile Worker is not accepting Sessions.')
      const live = this.control.getWorkerControlStatus(worker.id)
      if (live.protocolMinor === null || live.protocolMinor < 19)
        throw failure(
          'WORKER_PROTOCOL_INCOMPATIBLE',
          'Storage admission requires Worker control protocol 1.19.',
        )
      if (
        !live.connected ||
        !live.ready ||
        !Value.Check(WorkerCapabilityReportSchema, worker.capabilities) ||
        worker.capabilities.status !== 'READY'
      )
        throw failure(
          'WORKER_UNAVAILABLE',
          'The Worker has not completed runtime readiness and reconciliation.',
        )
      assertStorageAdmission(worker, profile)
      const supportedCapabilities = worker.capabilities.supportedCapabilities
      if (
        !['noticeRequests', 'navigationConfirmation', 'navigationState', 'advancedQuality'].every(
          (capability) => supportedCapabilities.includes(capability),
        )
      )
        throw failure(
          'WORKER_UNAVAILABLE',
          'The Worker runtime does not support structured Notice, navigation confirmation and advanced media quality.',
        )
      if (maintenance && !supportedCapabilities.includes('windowSelection'))
        throw failure(
          'WORKER_UNAVAILABLE',
          'Maintenance requires a Worker runtime with owned-window selection.',
        )
      if (
        (profile.runtimeDesiredState === 'STOPPED' && profile.runtimeState !== 'STOPPED') ||
        ![
          'RUNNING',
          'STOPPED',
          'STARTING',
          ...(maintenance || profile.runtimeMode === 'ON_DEMAND' ? ['ERROR'] : []),
        ].includes(profile.runtimeState) ||
        (profile.runtimeState === 'STOPPED' && profile.runtimeMode !== 'ON_DEMAND' && !maintenance)
      )
        throw failure('PROFILE_NOT_READY', 'The Profile Runtime cannot accept a new Session.')
      if (profile.healthcheckUrl === null)
        throw failure(
          'PROFILE_HEALTHCHECK_REQUIRED',
          'The Profile requires an HTTPS health check before use.',
        )
      if (profile.runtimeState === 'RUNNING' && profile.runtimeProxyHealth?.status !== 'HEALTHY')
        throw failure(
          'PROFILE_PROXY_UNHEALTHY',
          'The current Profile Runtime route is not healthy.',
        )

      // Each successful reservation inserts one nonterminal Session. Never add Reservation rows
      // to these counts: that would count an accepted or reserved Session twice.
      for (const [scope, column, id, limit] of [
        ['USER', tabSessions.userId, userId, user.maxActiveSessions],
        ['PROFILE', tabSessions.profileId, profileId, profile.maxNormalSessions],
        ['WORKER', tabSessions.workerId, worker.id, worker.maxActiveTabs],
      ] as const) {
        if (limit === null || (maintenance && scope !== 'WORKER')) continue
        const [row] = await tx
          .select({ active: count() })
          .from(tabSessions)
          .where(
            and(
              eq(column, id),
              notInArray(tabSessions.status, [...TERMINAL]),
              maintenance
                ? sql`${tabSessions.profileId} <> ${profileId}`
                : scope === 'WORKER'
                  ? undefined
                  : eq(tabSessions.kind, 'NORMAL'),
            ),
          )
        if (row!.active >= limit)
          throw new BrowShareError({
            code: 'SESSION_CAPACITY_EXCEEDED',
            statusCode: 409,
            message: 'No Session capacity is available. Sessions are not queued.',
            details: { scope, limit, active: row!.active },
          })
      }
      const policy = await resolveSessionPolicy(tx, userId, profileId)
      let publication: Awaited<ReturnType<typeof readSessionPublication>> | undefined
      if (creation !== undefined) {
        let url: URL
        try {
          url = new URL(creation.initialUrl)
        } catch {
          throw failure('BAD_REQUEST', 'Initial URL is invalid.', 400)
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw failure(
            'BAD_REQUEST',
            'Initial URL must use HTTP or HTTPS without credentials.',
            400,
          )
        creation = { ...creation, initialUrl: url.href }
        publication = await readSessionPublication(
          tx,
          profileId,
          maintenance,
          creation.pageScriptVersionId,
        )
      }
      if (profile.runtimeState === 'STOPPED' || profile.runtimeState === 'ERROR') {
        const command = await persistProfileRuntimeOperation(tx, profile, 'START', this.control)
        await tx.insert(auditEvents).values({
          id: createPublicId(),
          actorUserId: userId,
          action: maintenance ? 'profile.runtime.maintenance' : 'profile.runtime.on_demand',
          targetType: 'profile',
          targetId: profileId,
          result: 'SUCCEEDED',
          metadata: { generation: command.payload.generation, commandId: command.messageId },
          ...(requestId === undefined ? {} : { requestId }),
        })
      }
      await tx.update(profiles).set({ runtimeIdleSince: null }).where(eq(profiles.id, profileId))
      const sessionId = createPublicId()
      const transferSettings = await readSessionTransferSettings(tx, 'share')
      const mediaSettings = await readSessionMediaSettings(tx, 'share')
      const globalQuality = mediaSettings.qualityPolicy
      const profileQuality = profile.qualityPolicy
      // Global limits are ceilings, not defaults that a Profile can override upwards.
      const qualityPolicy = {
        maxWidth: Math.min(globalQuality.maxWidth, profileQuality.maxWidth),
        maxHeight: Math.min(globalQuality.maxHeight, profileQuality.maxHeight),
        maxFps: Math.min(globalQuality.maxFps, profileQuality.maxFps),
        maxBitrateKbps:
          globalQuality.maxBitrateKbps === null
            ? profileQuality.maxBitrateKbps
            : profileQuality.maxBitrateKbps === null
              ? globalQuality.maxBitrateKbps
              : Math.min(globalQuality.maxBitrateKbps, profileQuality.maxBitrateKbps),
      }
      const capabilities = [
        'navigation',
        'backForward',
        'reload',
        ...(transferSettings.uploadEnabled ? ['upload'] : []),
        ...(transferSettings.downloadEnabled ? ['download'] : []),
        ...(transferSettings.clipboardTextEnabled ? ['clipboardText'] : []),
        ...(transferSettings.clipboardImageEnabled ? ['clipboardImage'] : []),
        'localOpen',
        'noticeRequests',
        'navigationConfirmation',
        'navigationState',
        ...(supportedCapabilities.includes('cursorFeedback') ? ['cursorFeedback'] : []),
        'fullscreen',
        'qualityControl',
        'advancedQuality',
        'diagnostics',
        ...(maintenance ? ['windowSelection'] : []),
        ...(profile.tabAudioEnabled && mediaSettings.tabAudioEnabled ? ['tabAudio'] : []),
      ]
      const bindingToken =
        creation === undefined ? undefined : randomBytes(32).toString('base64url')
      const [session] = await tx
        .insert(tabSessions)
        .values({
          id: sessionId,
          userId,
          profileId,
          workerId: worker.id,
          kind: maintenance ? 'MAINTENANCE' : 'NORMAL',
          status: 'RESERVED',
          policySnapshot: policy,
          capabilities: { allowed: capabilities },
          ...(creation === undefined
            ? {}
            : {
                gatewayId: creation.gateway.id,
                coreBindingTokenDigest: createHash('sha256').update(bindingToken!).digest('hex'),
                navigationPolicyVersionId: publication!.navigationPolicy?.versionId ?? null,
                pageScriptVersionId: publication!.pageScript?.versionId ?? null,
              }),
          leaseExpiresAt: sql`clock_timestamp() + ${LEASE_MILLISECONDS} * interval '1 millisecond'`,
        })
        .returning()
      const [reservation] = await tx
        .insert(reservations)
        .values({
          id: createPublicId(),
          messageId: createPublicId(),
          sessionId,
          userId,
          profileId,
          workerId: worker.id,
          expiresAt: sql`clock_timestamp() + ${RESERVATION_MILLISECONDS} * interval '1 millisecond'`,
        })
        .returning()
      await appendSessionEvent(tx, sessionId, 'session.reserved', {
        reservationId: reservation!.id,
      })
      if (creation !== undefined) {
        const [runtime] = await tx.select().from(profiles).where(eq(profiles.id, profileId))
        const [profileContext] =
          publication!.pageScript === null
            ? []
            : await tx
                .select({ variables: userProfileContexts.variables })
                .from(userProfileContexts)
                .where(
                  and(
                    eq(userProfileContexts.profileId, profileId),
                    eq(userProfileContexts.userId, user.id),
                  ),
                )
        const variables = profileContext?.variables ?? {}
        validateProfileContextVariables(variables)
        if (!runtime?.runtimeId || !runtime.runtimeWorkerInstanceId)
          throw failure('PROFILE_NOT_READY', 'Profile Runtime identity is not available.')
        const payload = {
          workerStoragePolicy: {
            version: worker.storagePolicyVersion,
            quotaBytes: worker.storageQuotaBytes,
          },
          profileStoragePolicy: {
            profileId,
            version: profile.storagePolicyVersion,
            quotaBytes: profile.storageQuotaBytes,
          },
          workerId: worker.id,
          instanceId: runtime.runtimeWorkerInstanceId,
          sessionId,
          profileId,
          runtimeId: runtime.runtimeId,
          profileGeneration: runtime.runtimeGeneration,
          expiresAt: new Date(reservation!.expiresAt).toISOString(),
          leaseExpiresAt: new Date(session!.leaseExpiresAt!).toISOString(),
          createdAt: new Date(session!.createdAt).toISOString(),
          policy: policy.values,
          qualityPolicy,
          transferSettings,
          initialUrl: creation.initialUrl,
          capabilities,
          signaling: {
            gatewayId: creation.gateway.id,
            endpoint: creation.gateway.publicEndpoint,
            bindingToken: bindingToken!,
          },
          navigationUser: { id: user.id, displayName: user.displayName },
          pageScript:
            publication!.pageScript === null
              ? null
              : {
                  ...publication!.pageScript,
                  context: {
                    user_id: user.id,
                    display_name: user.displayName,
                    profile_id: profileId,
                    variables,
                  },
                },
        }
        const command: WorkerSessionCreateCommandMessage = {
          protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
          protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
          type: 'session.create',
          messageId: reservation!.messageId,
          correlationId: null,
          sentAt: Date.now(),
          ...(maintenance
            ? { payload: { ...payload, kind: 'MAINTENANCE' as const, navigationPolicy: null } }
            : { payload: { ...payload, navigationPolicy: publication!.navigationPolicy! } }),
        }
        try {
          encodeWorkerControlMessage(command)
        } catch {
          throw failure(
            'SESSION_CONFIGURATION_INVALID',
            'Published Session configuration exceeds the control protocol limits.',
          )
        }
        await tx.insert(sessionCreateOutbox).values({
          id: command.messageId,
          sessionId,
          command,
          expiresAt: reservation!.expiresAt,
        })
      }
      if (maintenance) {
        const existing = await tx
          .select()
          .from(tabSessions)
          .where(
            and(
              eq(tabSessions.profileId, profileId),
              eq(tabSessions.kind, 'NORMAL'),
              notInArray(tabSessions.status, [...TERMINAL]),
            ),
          )
          .orderBy(asc(tabSessions.id))
          .for('update')
        for (const normal of existing)
          await queueSessionClose(tx, normal, 'ADMIN_REQUESTED', {
            actorUserId: userId,
            ...(requestId === undefined ? {} : { requestId }),
          })
      }
      await tx.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: userId,
        action: 'session.reserve',
        targetType: 'session',
        targetId: sessionId,
        result: 'SUCCEEDED',
        metadata: {
          profileId,
          workerId: worker.id,
          policyScope: policy.scope,
          kind: maintenance ? 'MAINTENANCE' : 'NORMAL',
          ...(creation === undefined ? {} : { commandId: reservation!.messageId }),
        },
        ...(requestId === undefined ? {} : { requestId }),
      })
      return { session: session!, reservation: reservation! }
    })
  }

  /** Called before the first command delivery; repeats do not extend the reservation deadline. */
  async begin(messageId: string): Promise<ReservedSession> {
    return this.#withPending(
      messageId,
      async (tx, session, reservation, profile) => {
        if (
          !profile.runtimeId ||
          !profile.runtimeWorkerInstanceId ||
          profile.runtimeGeneration < 1 ||
          profile.runtimeDesiredState !== 'RUNNING' ||
          !(
            session.kind === 'MAINTENANCE' ? ['RUNNING', 'MAINTAINING'] : ['RUNNING', 'STARTING']
          ).includes(profile.runtimeState)
        )
          throw failure(
            'PROFILE_NOT_READY',
            'Start the Profile Runtime before delivering the Session command.',
          )
        if (session.kind === 'MAINTENANCE') {
          const [other] = await tx
            .select({ id: tabSessions.id })
            .from(tabSessions)
            .where(
              and(
                eq(tabSessions.profileId, profile.id),
                sql`${tabSessions.id} <> ${session.id}`,
                notInArray(tabSessions.status, [...TERMINAL]),
              ),
            )
            .limit(1)
          if (other)
            throw failure('PROFILE_MAINTENANCE_DRAINING', 'Existing Sessions are still closing.')
          await tx
            .update(profiles)
            .set({ runtimeState: 'MAINTAINING', updatedAt: sql`clock_timestamp()` })
            .where(eq(profiles.id, profile.id))
        }
        if (session.status === 'RESERVED') {
          session.runtimeId = profile.runtimeId
          session.profileGeneration = profile.runtimeGeneration
          session.workerInstanceId = profile.runtimeWorkerInstanceId
          await tx
            .update(tabSessions)
            .set({
              status: 'CREATING',
              runtimeId: session.runtimeId,
              profileGeneration: session.profileGeneration,
              workerInstanceId: session.workerInstanceId,
              updatedAt: sql`now()`,
            })
            .where(eq(tabSessions.id, session.id))
          await appendSessionEvent(tx, session.id, 'session.creating', {})
          session.status = 'CREATING'
        } else if (
          session.runtimeId !== profile.runtimeId ||
          session.profileGeneration !== profile.runtimeGeneration ||
          session.workerInstanceId !== profile.runtimeWorkerInstanceId
        ) {
          throw failure('SESSION_RUNTIME_CHANGED', 'The reserved Profile Runtime has changed.')
        }
        return { session, reservation }
      },
      false,
      true,
    )
  }

  /** A Worker result is accepted only for the reservation's current persistent Profile identity. */
  async accept(
    messageId: string,
    instanceId: string,
    fact: WorkerSessionRuntimeFact,
    observedAt: string,
  ): Promise<void> {
    assertId(instanceId)
    if (!Number.isFinite(Date.parse(observedAt)))
      throw new TypeError('A Worker result observation time is required')
    await this.#withPending(
      messageId,
      async (tx, session, reservation, profile) => {
        if (
          fact.status !== 'READY' ||
          fact.tabId === null ||
          fact.targetId === null ||
          fact.sessionId !== session.id ||
          fact.profileId !== session.profileId ||
          profile.runtimeId !== fact.runtimeId ||
          profile.runtimeGeneration !== fact.profileGeneration ||
          profile.runtimeWorkerInstanceId !== instanceId ||
          session.runtimeId !== fact.runtimeId ||
          session.profileGeneration !== fact.profileGeneration ||
          session.workerInstanceId !== instanceId ||
          profile.runtimeState !== (session.kind === 'MAINTENANCE' ? 'MAINTAINING' : 'RUNNING') ||
          profile.runtimeDesiredState !== 'RUNNING' ||
          fact.viewerGeneration !== 0 ||
          fact.leaseExpiresAt === null ||
          (reservation.status === 'ACTIVE' &&
            new Date(fact.leaseExpiresAt).getTime() !== new Date(session.leaseExpiresAt!).getTime())
        )
          throw failure(
            'SESSION_RESULT_MISMATCH',
            'The Worker result does not match the reserved Session.',
          )
        if (reservation.status === 'CONSUMED') {
          if (session.tabId !== fact.tabId || session.targetId !== fact.targetId)
            throw failure(
              'SESSION_RESULT_MISMATCH',
              'The accepted Session has a different Tab identity.',
            )
          return
        }
        if (session.status !== 'CREATING')
          throw failure(
            'RESERVATION_NOT_ACTIVE',
            'Begin Session delivery before accepting its result.',
          )
        await tx
          .update(tabSessions)
          .set({
            status: 'READY',
            tabId: fact.tabId,
            targetId: fact.targetId,
            remoteTitle: fact.remoteTitle,
            recycling: fact.recycling ?? null,
            ...(fact.lastInputAt === undefined ? {} : { lastInputAt: fact.lastInputAt }),
            ...(fact.lastFrameChangedAt === undefined
              ? {}
              : { lastFrameChangedAt: fact.lastFrameChangedAt }),
            runtimeObservedAt: observedAt,
            updatedAt: sql`now()`,
          })
          .where(eq(tabSessions.id, session.id))
        await tx
          .update(reservations)
          .set({ status: 'CONSUMED', consumedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(reservations.id, reservation.id))
        await appendSessionEvent(tx, session.id, 'session.ready', {})
      },
      true,
    )
  }

  async fail(messageId: string, code: string): Promise<void> {
    assertId(messageId)
    if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(code))
      throw new TypeError('Session failure requires a stable reason code')
    await this.connection.db.transaction(async (tx) => {
      const record = await lockReservationSession(tx, messageId)
      if (
        !record ||
        record.reservation.status !== 'ACTIVE' ||
        !PENDING.includes(record.session.status as (typeof PENDING)[number])
      )
        return
      await finishReservation(tx, record.session, record.reservation, code, 'RELEASED')
    })
  }

  async expire(): Promise<number> {
    return this.connection.db.transaction(async (tx) => {
      const expired = await tx
        .select({ session: tabSessions, reservation: reservations })
        .from(tabSessions)
        .innerJoin(reservations, eq(reservations.sessionId, tabSessions.id))
        .where(
          and(
            eq(reservations.status, 'ACTIVE'),
            sql`${reservations.expiresAt} <= clock_timestamp()`,
            inArray(tabSessions.status, [...PENDING]),
          ),
        )
        .orderBy(asc(reservations.expiresAt))
        .limit(100)
        .for('update', { of: tabSessions, skipLocked: true })
      for (const record of expired) {
        // Selection may have waited behind acceptance. Re-read under the Session lock.
        const [reservation] = await tx
          .select()
          .from(reservations)
          .where(eq(reservations.id, record.reservation.id))
          .for('update')
        if (reservation?.status !== 'ACTIVE') continue
        await finishReservation(
          tx,
          record.session,
          reservation,
          'SESSION_RESERVATION_EXPIRED',
          'EXPIRED',
        )
      }
      return expired.length
    })
  }

  async #withPending<T>(
    messageId: string,
    operation: (
      tx: PolicyTransaction,
      session: SessionRecord,
      reservation: ReservationRecord,
      profile: typeof profiles.$inferSelect,
    ) => Promise<T>,
    allowConsumed = false,
    revalidateAccess = false,
  ): Promise<T> {
    assertId(messageId)
    return this.connection.db.transaction(async (tx) => {
      if (revalidateAccess) await tx.execute(sql`select pg_advisory_xact_lock_shared(28691, 1)`)
      const [owner] = await tx
        .select({ profileId: reservations.profileId, userId: reservations.userId })
        .from(reservations)
        .where(eq(reservations.messageId, messageId))
      if (!owner)
        throw failure('RESERVATION_NOT_FOUND', 'The Session reservation does not exist.', 404)
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, owner.profileId))
        .for('update')
      if (revalidateAccess) {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, owner.userId))
          .for('update')
      }
      const record = await lockReservationSession(tx, messageId)
      if (
        !record ||
        !(
          (record.reservation.status === 'ACTIVE' &&
            PENDING.includes(record.session.status as (typeof PENDING)[number])) ||
          (allowConsumed &&
            record.reservation.status === 'CONSUMED' &&
            ['READY', 'CONNECTED', 'SUSPENDED', 'DISCONNECTED'].includes(record.session.status))
        )
      )
        throw failure('RESERVATION_NOT_ACTIVE', 'The Session reservation is no longer pending.')
      if (
        revalidateAccess &&
        !(await authorized(
          tx,
          record.session.userId,
          record.session.profileId,
          record.session.kind,
        ))
      )
        throw failure(
          'SESSION_AUTHORIZATION_REVOKED',
          'Session authorization changed before creation.',
          403,
        )
      const [clock] = await tx.execute<{ expired: boolean }>(
        sql`select ${record.reservation.expiresAt}::timestamptz <= clock_timestamp() as expired`,
      )
      if (record.reservation.status === 'ACTIVE' && clock!.expired)
        throw failure('SESSION_RESERVATION_EXPIRED', 'The Session reservation has expired.')
      if (!profile) throw failure('PROFILE_NOT_READY', 'The Session Profile no longer exists.')
      return operation(tx, record.session, record.reservation, profile)
    })
  }

  #scheduleExpiry(): void {
    if (this.#closed || this.#expiryRun !== undefined) return
    this.#expiryRun = this.expire()
      .then(() => undefined)
      .catch(this.onError)
      .finally(() => {
        this.#expiryRun = undefined
      })
  }
}

async function readSessionPublication(
  tx: PolicyTransaction,
  profileId: string,
  maintenance: boolean,
  testVersionId?: string,
) {
  const [publication] = await tx
    .select()
    .from(profilePublications)
    .where(eq(profilePublications.profileId, profileId))
  const [navigation] =
    !maintenance && publication?.navigationPolicyVersionId
      ? await tx
          .select()
          .from(navigationPolicyVersions)
          .where(
            and(
              eq(navigationPolicyVersions.id, publication.navigationPolicyVersionId),
              eq(navigationPolicyVersions.profileId, profileId),
              eq(navigationPolicyVersions.state, 'PUBLISHED'),
            ),
          )
      : []
  if (!maintenance && !navigation)
    throw failure(
      'NAVIGATION_POLICY_REQUIRED',
      'Publish a Navigation Policy before creating Sessions.',
    )
  const navigationPolicy = navigation
    ? {
        versionId: navigation.id,
        defaultAction: navigation.defaultAction,
        rules: navigation.rules,
        policyScript: navigation.policyScript,
      }
    : null
  if (navigationPolicy !== null && !Value.Check(SessionNavigationPolicySchema, navigationPolicy))
    throw failure('NAVIGATION_POLICY_INVALID', 'The published Navigation Policy is invalid.')
  let pageScript: { versionId: string; source: string } | null = null
  const scriptId = testVersionId ?? publication?.pageScriptVersionId
  if (scriptId != null) {
    const [script] = await tx
      .select()
      .from(pageScriptVersions)
      .where(
        and(
          eq(pageScriptVersions.id, scriptId),
          eq(pageScriptVersions.profileId, profileId),
          testVersionId === undefined ? eq(pageScriptVersions.state, 'PUBLISHED') : undefined,
        ),
      )
    if (!script)
      throw failure('PAGE_SCRIPT_INVALID', 'The Page Script publication is not available.')
    if (
      testVersionId !== undefined ||
      script.appliesTo === 'BOTH' ||
      script.appliesTo === (maintenance ? 'MAINTENANCE' : 'NORMAL')
    )
      pageScript = { versionId: script.id, source: script.sourceCode }
    if (pageScript !== null && !Value.Check(SessionPageScriptSchema, pageScript))
      throw failure('PAGE_SCRIPT_INVALID', 'The published Page Script exceeds the Session limits.')
  }
  return { navigationPolicy, pageScript }
}

async function lockReservationSession(tx: PolicyTransaction, messageId: string) {
  const [owner] = await tx
    .select({ sessionId: reservations.sessionId })
    .from(reservations)
    .where(eq(reservations.messageId, messageId))
  if (!owner) return undefined
  const [session] = await tx
    .select()
    .from(tabSessions)
    .where(eq(tabSessions.id, owner.sessionId))
    .for('update')
  const [reservation] = await tx
    .select()
    .from(reservations)
    .where(eq(reservations.messageId, messageId))
    .for('update')
  return session && reservation ? { session, reservation } : undefined
}

async function finishReservation(
  tx: PolicyTransaction,
  session: SessionRecord,
  reservation: ReservationRecord,
  code: string,
  state: 'RELEASED' | 'EXPIRED',
) {
  await tx
    .update(tabSessions)
    .set({
      status: 'FAILED',
      failureCode: code,
      failureSummary: 'The Session could not be created.',
      closedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(tabSessions.id, session.id))
  await tx
    .update(reservations)
    .set({ status: state, releasedAt: sql`now()`, releaseReason: code, updatedAt: sql`now()` })
    .where(eq(reservations.id, reservation.id))
  await appendSessionEvent(tx, session.id, 'session.failed', { code })
  await tx.insert(auditEvents).values({
    id: createPublicId(),
    action: 'session.create',
    targetType: 'session',
    targetId: session.id,
    result: 'FAILED',
    metadata: { code },
  })
}

/** Callers hold the Session row lock, or have just inserted it in the same transaction. */

function assertId(id: string): void {
  if (!isPublicId(id)) throw failure('BAD_REQUEST', 'Session identities must be UUIDv7.', 400)
}

function failure(code: string, message: string, statusCode = 409): BrowShareError {
  return new BrowShareError({ code, message, statusCode })
}
