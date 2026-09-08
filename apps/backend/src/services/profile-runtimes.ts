import { profileRuntimeRecovery } from './worker-runtime-recovery.js'
import { queueSessionClose } from './session-closure.js'
import { assertStorageAdmission, storageBlockReason } from './storage.js'
import { isStorageBlockReason } from '@browshare/contracts'
import { BrowShareError, createPublicId, isPublicId } from '@browshare/common'
import {
  decodeWorkerControlMessage,
  encodeWorkerControlMessage,
  type ProfileResponse,
  type SetProfileRuntimeRequest,
  type WorkerProfileRuntimeCommandMessage,
  type WorkerProfileRuntimeResultMessage,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  profileRuntimeOutbox,
  profiles,
  proxies,
  tabSessions,
  workers,
} from '@browshare/database/schema'
import { and, asc, eq, isNull, isNotNull, notInArray, sql } from 'drizzle-orm'
import { ProfileService, type ProfileAuditContext } from './profiles.js'
import { recordProfileRuntimeFailure } from './profile-runtime-recovery.js'
import { WorkerCommandError, type WorkerControlServer } from './worker-control-server.js'

export interface ProfileRuntimePort {
  setRuntime(
    profileId: string,
    input: SetProfileRuntimeRequest,
    context: ProfileAuditContext,
  ): Promise<ProfileResponse>
}

type SavedOperation = typeof profileRuntimeOutbox.$inferSelect
type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]

/** Database intent and an immutable outbox own delivery across Backend restarts. */
export class ProfileRuntimeService implements ProfileRuntimePort {
  readonly #active = new Map<string, Promise<void>>()
  #timer: NodeJS.Timeout | undefined
  #closed = false
  #tick: Promise<void> | undefined

  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: Pick<
      WorkerControlServer,
      'prepareProfileRuntime' | 'dispatchProfileRuntime' | 'getWorkerControlStatus'
    >,
    private readonly onError: (error: unknown) => void,
  ) {}

  start(): void {
    this.#timer = setInterval(() => this.#schedule(), 1000)
    this.#timer.unref()
    this.#schedule()
  }

  stop(): void {
    this.#closed = true
    if (this.#timer !== undefined) clearInterval(this.#timer)
  }

  async drain(): Promise<void> {
    await this.#tick
    await Promise.allSettled(this.#active.values())
  }

  async setRuntime(
    profileId: string,
    input: SetProfileRuntimeRequest,
    context: ProfileAuditContext,
  ): Promise<ProfileResponse> {
    const { action } = input
    const recovering = action === 'STOP' && input.closeSessions === true
    if (!isPublicId(profileId)) throw failure('BAD_REQUEST', 'Profile ID must be a UUIDv7.', 400)
    await this.connection.db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(and(eq(profiles.id, profileId), isNull(profiles.deletedAt)))
        .for('update')
      if (profile === undefined) throw failure('NOT_FOUND', 'Profile does not exist.', 404)
      if (profile.deleteRequestedAt !== null && !recovering)
        throw failure('CONFLICT', 'Profile deletion owns Runtime cleanup.')
      if (action === 'START') {
        if (profile.businessStatus !== 'ENABLED')
          throw failure('CONFLICT', 'Enable the Profile before starting it.')
        if (
          ['RUNNING', 'STARTING', 'MAINTAINING'].includes(profile.runtimeState) &&
          profile.runtimeDesiredState === 'RUNNING'
        )
          return
        if (profile.runtimeState === 'STOPPING')
          throw failure('CONFLICT', 'Wait until the Profile has stopped.')
      } else {
        if (
          !recovering &&
          profile.runtimeMode === 'ALWAYS_ON' &&
          profile.businessStatus === 'ENABLED'
        )
          throw failure(
            'CONFLICT',
            'Disable this ALWAYS_ON Profile or change its run mode before stopping it.',
          )
        if (
          !recovering &&
          (profile.runtimeState === 'STOPPED' ||
            (profile.runtimeState === 'STOPPING' && profile.runtimeDesiredState === 'STOPPED'))
        )
          return
      }
      const [worker] = await tx
        .select()
        .from(workers)
        .where(and(eq(workers.id, profile.workerId), isNull(workers.deletedAt)))
      if (recovering) {
        const recovery = profileRuntimeRecovery(
          profile,
          worker,
          this.control.getWorkerControlStatus(profile.workerId),
        )
        if (!recovery.canRecover)
          throw failure('CONFLICT', `Profile recovery is unavailable: ${recovery.blockedReason}.`)
      } else if (
        worker === undefined ||
        !['ONLINE', ...(action === 'STOP' ? ['DRAINING'] : [])].includes(worker.status)
      )
        throw failure('CONFLICT', 'The Worker must be online and available for this operation.')
      const activeSessions = await tx
        .select()
        .from(tabSessions)
        .where(
          and(
            eq(tabSessions.profileId, profileId),
            notInArray(tabSessions.status, ['CLOSED', 'FAILED']),
          ),
        )
        .orderBy(asc(tabSessions.id))
        .for('update')
      if (!recovering && activeSessions.length > 0)
        throw failure('CONFLICT', 'End active Sessions before changing the Profile Runtime.')
      if (recovering) {
        for (const session of activeSessions)
          await queueSessionClose(tx, session, 'ADMIN_REQUESTED', context)
        if (profile.runtimeMode === 'ALWAYS_ON')
          await tx.update(profiles).set({ runtimeMode: 'MANUAL' }).where(eq(profiles.id, profileId))
      }
      if (action === 'START') assertStorageAdmission(worker!, profile)
      if (action === 'START')
        await tx
          .update(profiles)
          .set({ runtimeFailureCount: 0, runtimeRetryAt: null })
          .where(eq(profiles.id, profileId))
      const command = await persistProfileRuntimeOperation(tx, profile, action, this.control)
      await tx.insert(auditEvents).values({
        id: createPublicId(),
        result: 'SUCCEEDED',
        actorUserId: context.actorUserId,
        action: `profile.runtime.${action.toLowerCase()}`,
        targetType: 'profile',
        targetId: profileId,
        metadata: {
          generation: command.payload.generation,
          commandId: command.messageId,
          ...(recovering
            ? {
                closeSessions: true,
                previousRuntimeMode: profile.runtimeMode,
                runtimeMode: profile.runtimeMode === 'ALWAYS_ON' ? 'MANUAL' : profile.runtimeMode,
              }
            : {}),
        },
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      })
    })
    this.#schedule()
    return new ProfileService(this.connection, this.control).get(profileId)
  }

  #schedule(): void {
    if (this.#closed || this.#tick !== undefined) return
    this.#tick = this.#dispatchPending()
      .catch(this.onError)
      .finally(() => {
        this.#tick = undefined
      })
  }

  async #queueDeletions(): Promise<void> {
    const pending = await this.connection.db
      .select({ id: profiles.id, workerId: profiles.workerId })
      .from(profiles)
      .where(
        and(
          isNotNull(profiles.deleteRequestedAt),
          isNull(profiles.deletedAt),
          sql`not exists (select 1 from ${profileRuntimeOutbox} where ${profileRuntimeOutbox.profileId} = ${profiles.id})`,
          sql`not exists (select 1 from ${tabSessions} where ${tabSessions.profileId} = ${profiles.id} and ${tabSessions.status} not in ('CLOSED', 'FAILED'))`,
          sql`(${profiles.runtimeErrorCode} is null or ${profiles.updatedAt} < now() - interval '30 seconds')`,
          sql`exists (select 1 from ${workers} where ${workers.id} = ${profiles.workerId} and ${workers.status} in ('ONLINE', 'DRAINING'))`,
        ),
      )
      .orderBy(asc(profiles.updatedAt))
      .limit(256)
    for (const candidate of pending) {
      if (this.#closed) return
      const status = this.control.getWorkerControlStatus(candidate.workerId)
      if (!status.ready || (status.protocolMinor ?? 0) < 10) continue
      await this.connection.db.transaction(async (tx) => {
        const [profile] = await tx
          .select()
          .from(profiles)
          .where(eq(profiles.id, candidate.id))
          .for('update')
        if (!profile || profile.deletedAt !== null || profile.deleteRequestedAt === null) return
        const [operation] = await tx
          .select({ id: profileRuntimeOutbox.id })
          .from(profileRuntimeOutbox)
          .where(eq(profileRuntimeOutbox.profileId, profile.id))
          .limit(1)
        const [session] = await tx
          .select({ id: tabSessions.id })
          .from(tabSessions)
          .where(
            and(
              eq(tabSessions.profileId, profile.id),
              notInArray(tabSessions.status, ['CLOSED', 'FAILED']),
            ),
          )
          .limit(1)
        if (operation || session) return
        await persistProfileRuntimeOperation(tx, profile, 'DELETE', this.control)
      })
    }
  }

  async #queueModeOperations(): Promise<void> {
    const candidates = await this.connection.db
      .select({ id: profiles.id, workerId: profiles.workerId })
      .from(profiles)
      .where(
        and(
          isNull(profiles.deletedAt),
          isNull(profiles.deleteRequestedAt),
          sql`exists (select 1 from ${workers} where ${workers.id} = ${profiles.workerId} and ${workers.status} in ('ONLINE', 'DRAINING'))`,
        ),
      )
      .orderBy(asc(profiles.id))
    for (const candidate of candidates) {
      if (this.#closed) return
      if (!this.control.getWorkerControlStatus(candidate.workerId).ready) continue
      await this.connection.db.transaction(async (tx) => {
        const [profile] = await tx
          .select()
          .from(profiles)
          .where(eq(profiles.id, candidate.id))
          .for('update')
        if (!profile || profile.deletedAt !== null || profile.deleteRequestedAt !== null) return
        const [worker] = await tx
          .select({
            status: workers.status,
            storageQuotaBytes: workers.storageQuotaBytes,
            storagePolicyVersion: workers.storagePolicyVersion,
            storageSnapshot: workers.storageSnapshot,
          })
          .from(workers)
          .where(eq(workers.id, profile.workerId))
        if (!worker || !['ONLINE', 'DRAINING'].includes(worker.status)) return
        const [pending] = await tx
          .select({ id: profileRuntimeOutbox.id })
          .from(profileRuntimeOutbox)
          .where(eq(profileRuntimeOutbox.profileId, profile.id))
          .limit(1)
        if (pending || ['STARTING', 'STOPPING', 'MAINTAINING'].includes(profile.runtimeState))
          return
        const [session] = await tx
          .select({ id: tabSessions.id })
          .from(tabSessions)
          .where(
            and(
              eq(tabSessions.profileId, profile.id),
              notInArray(tabSessions.status, ['CLOSED', 'FAILED']),
            ),
          )
          .limit(1)
        const now = Date.now()
        if (
          profile.runtimeState === 'RUNNING' &&
          profile.runtimeFailureCount > 0 &&
          profile.runtimeHealthySince !== null &&
          now - Date.parse(profile.runtimeHealthySince) >= 300_000
        )
          await tx
            .update(profiles)
            .set({
              runtimeFailureCount: 0,
              runtimeRetryAt: null,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(eq(profiles.id, profile.id))
        if (session) {
          if (profile.runtimeIdleSince !== null)
            await tx
              .update(profiles)
              .set({ runtimeIdleSince: null })
              .where(eq(profiles.id, profile.id))
          return
        }
        let action: 'START' | 'STOP' | undefined
        if (profile.businessStatus === 'DISABLED') {
          if (['RUNNING', 'ERROR'].includes(profile.runtimeState)) action = 'STOP'
        } else if (
          profile.runtimeMode === 'ALWAYS_ON' &&
          worker.status === 'ONLINE' &&
          ['STOPPED', 'ERROR'].includes(profile.runtimeState)
        ) {
          if (
            profile.runtimeFailureCount >= 5 ||
            (profile.runtimeRetryAt !== null && Date.parse(profile.runtimeRetryAt) > now)
          )
            return
          if (
            storageBlockReason(worker, profile) ||
            profile.runtimeErrorCode === 'PROFILE_DATA_MISSING'
          )
            return
          if (
            isStorageBlockReason(profile.runtimeErrorCode) &&
            (!worker.storageSnapshot ||
              Date.parse(worker.storageSnapshot.observedAt) <=
                Date.parse(profile.runtimeObservedAt ?? profile.updatedAt))
          )
            return
          if (profile.healthcheckUrl === null) {
            if (profile.runtimeErrorCode !== 'PROFILE_HEALTHCHECK_REQUIRED')
              await tx
                .update(profiles)
                .set({
                  runtimeState: 'ERROR',
                  runtimeErrorCode: 'PROFILE_HEALTHCHECK_REQUIRED',
                  runtimeErrorSummary: 'Configure an HTTPS health check before automatic startup.',
                  updatedAt: sql`clock_timestamp()`,
                })
                .where(eq(profiles.id, profile.id))
            return
          }
          action = 'START'
        } else if (profile.runtimeMode === 'ON_DEMAND' && profile.runtimeState === 'RUNNING') {
          if (profile.runtimeIdleSince === null) {
            await tx
              .update(profiles)
              .set({ runtimeIdleSince: sql`clock_timestamp()` })
              .where(eq(profiles.id, profile.id))
            if (profile.runtimeIdleTimeoutSeconds > 0) return
          } else if (
            now - Date.parse(profile.runtimeIdleSince) <
            profile.runtimeIdleTimeoutSeconds * 1000
          )
            return
          action = 'STOP'
        }
        if (!action) return
        const command = await persistProfileRuntimeOperation(tx, profile, action, this.control)
        await tx.insert(auditEvents).values({
          id: createPublicId(),
          actorUserId: null,
          action: 'profile.runtime.automatic',
          targetType: 'profile',
          targetId: profile.id,
          result: 'SUCCEEDED',
          metadata: {
            mode: profile.runtimeMode,
            action,
            commandId: command.messageId,
            generation: command.payload.generation,
          },
        })
      })
    }
  }

  async #dispatchPending(): Promise<void> {
    await this.#queueDeletions()
    await this.#queueModeOperations()

    const pending = await this.connection.db
      .select()
      .from(profileRuntimeOutbox)
      .orderBy(asc(profileRuntimeOutbox.createdAt))
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

  async #deliver(operation: SavedOperation): Promise<void> {
    const decoded = decodeWorkerControlMessage(
      encodeWorkerControlMessage(operation.command as WorkerProfileRuntimeCommandMessage),
    )
    if (
      decoded.type !== 'profile.runtime.set' ||
      decoded.messageId !== operation.id ||
      decoded.payload.profileId !== operation.profileId ||
      decoded.payload.workerId !== operation.workerId
    )
      throw new Error('Stored Profile Runtime command identity is invalid')
    let result: WorkerProfileRuntimeResultMessage | undefined
    let error: { code: string; message: string } | undefined
    try {
      if (Date.parse(operation.expiresAt) <= Date.now())
        error = {
          code: 'WORKER_COMMAND_TIMEOUT',
          message: 'The Profile Runtime command expired before completion.',
        }
      else result = await this.control.dispatchProfileRuntime(decoded)
    } catch (cause) {
      if (this.#closed) return // Leave pending delivery durable for the next Backend process.
      if (
        cause instanceof WorkerCommandError &&
        cause.code === 'WORKER_UNAVAILABLE' &&
        Date.parse(operation.expiresAt) > Date.now()
      )
        return
      error =
        cause instanceof WorkerCommandError
          ? { code: cause.code, message: cause.message }
          : {
              code: 'PROFILE_RUNTIME_OPERATION_FAILED',
              message: 'The Profile Runtime operation failed.',
            }
    }
    if (this.#closed) return
    error ??= result?.payload.error ?? undefined
    await this.connection.db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, operation.profileId))
        .for('update')
      const [current] = await tx
        .select({ id: profileRuntimeOutbox.id })
        .from(profileRuntimeOutbox)
        .where(eq(profileRuntimeOutbox.profileId, operation.profileId))
      if (current?.id !== operation.id) return // A later stop/start owns this Profile now.
      if (decoded.payload.action === 'DELETE') {
        // Missing Runtime snapshots prove Chrome absence, not persistent directory removal.
        // Only this identity-checked success result may finalize deletion.
        if (
          profile !== undefined &&
          profile.deletedAt === null &&
          profile.deleteRequestedAt !== null &&
          profile.runtimeGeneration === decoded.payload.generation
        ) {
          const deleted = result?.payload.outcome === 'SUCCEEDED' && error === undefined
          await tx
            .update(profiles)
            .set({
              ...(deleted ? { deletedAt: sql`clock_timestamp()` } : {}),
              runtimeState: deleted ? 'STOPPED' : 'ERROR',
              runtimeDesiredState: 'STOPPED',
              runtimeErrorCode: deleted ? null : (error?.code ?? 'PROFILE_DIRECTORY_DELETE_FAILED'),
              runtimeErrorSummary: deleted
                ? null
                : (error?.message ?? 'Profile directory cleanup was not confirmed.'),
              updatedAt: sql`clock_timestamp()`,
            })
            .where(eq(profiles.id, profile.id))
          await tx.insert(auditEvents).values({
            id: createPublicId(),
            actorUserId: null,
            action: 'profile.delete.cleanup',
            targetType: 'profile',
            targetId: profile.id,
            result: deleted ? 'SUCCEEDED' : 'FAILED',
            metadata: {
              commandId: operation.id,
              generation: decoded.payload.generation,
              errorCode: error?.code ?? null,
            },
          })
        }
      } else if (
        profile !== undefined &&
        profile.runtimeGeneration === decoded.payload.generation &&
        !(
          result !== undefined &&
          !(result.payload.outcome === 'FAILED' && profile.runtimeState === 'ERROR') &&
          profile.runtimeWorkerInstanceId === result.payload.instanceId &&
          profile.runtimeObservedAt !== null &&
          Date.parse(result.payload.completedAt) <= Date.parse(profile.runtimeObservedAt)
        )
      ) {
        const state = decoded.payload.action === 'START' ? 'RUNNING' : 'STOPPED'
        const alreadyObserved = profile.runtimeState === state
        await tx
          .update(profiles)
          .set({
            runtimeState: error === undefined || alreadyObserved ? state : 'ERROR',
            ...(state === 'RUNNING' && (error === undefined || alreadyObserved)
              ? { dataInitialized: true }
              : {}),
            ...(result?.payload.runtime === null
              ? { runtimeProxyHealth: null, runtimeRouteVersion: null }
              : result?.payload.runtime === undefined
                ? {}
                : {
                    runtimeProxyHealth: result.payload.runtime.proxyHealth ?? null,
                    runtimeRouteVersion: result.payload.runtime.routeVersion ?? null,
                  }),
            runtimeErrorCode: alreadyObserved ? null : (error?.code ?? null),
            runtimeErrorSummary: alreadyObserved ? null : (error?.message ?? null),
            ...(result === undefined ? {} : { runtimeObservedAt: result.payload.completedAt }),
            updatedAt: sql`now()`,
          })
          .where(eq(profiles.id, profile.id))
        if (
          decoded.payload.action === 'START' &&
          error !== undefined &&
          !alreadyObserved &&
          !isStorageBlockReason(error.code)
        )
          await recordProfileRuntimeFailure(tx, profile.id, decoded.payload.generation)
      }
      await tx.delete(profileRuntimeOutbox).where(eq(profileRuntimeOutbox.id, operation.id))
    })
  }
}

/** Caller locks and authorizes the Profile; intent and delivery are committed together. */
export async function persistProfileRuntimeOperation(
  tx: Transaction,
  profile: typeof profiles.$inferSelect,
  action: 'START' | 'STOP' | 'DELETE',
  control: Pick<WorkerControlServer, 'prepareProfileRuntime'>,
): Promise<WorkerProfileRuntimeCommandMessage> {
  const profileId = profile.id
  const generation =
    action === 'START' ? profile.runtimeGeneration + 1 : Math.max(1, profile.runtimeGeneration)
  if (generation > 2147483647) throw failure('CONFLICT', 'Profile Runtime generation is exhausted.')
  let command: WorkerProfileRuntimeCommandMessage
  try {
    if (action === 'START') {
      const [storageWorker] = await tx
        .select()
        .from(workers)
        .where(eq(workers.id, profile.workerId))
        .for('update')
      if (!storageWorker) throw failure('CONFLICT', 'Worker does not exist.')
      assertStorageAdmission(storageWorker, profile)
      if (profile.healthcheckUrl === null)
        throw failure('CONFLICT', 'Configure the Profile HTTPS healthcheck URL before starting it.')
      let proxy: Extract<
        WorkerProfileRuntimeCommandMessage['payload'],
        { action: 'START' }
      >['proxy'] = { type: 'DIRECT' }
      if (profile.proxyId !== null) {
        const [route] = await tx
          .select()
          .from(proxies)
          .where(and(eq(proxies.id, profile.proxyId), isNull(proxies.deletedAt)))
        if (route === undefined) throw failure('CONFLICT', 'The configured Proxy is unavailable.')
        if (route.type !== 'DIRECT') {
          if (route.host === null || route.port === null)
            throw new Error('Stored Proxy route is incomplete')
          proxy = {
            type: route.type,
            host: route.host,
            port: route.port,
            username: route.username,
            password: route.password,
          }
        }
      }
      command = control.prepareProfileRuntime(profile.workerId, {
        action,
        profileId,
        generation,
        requireExistingData: profile.dataInitialized,
        proxy,
        healthcheckUrl: profile.healthcheckUrl,
        routeVersion: profile.routeVersion,
        workerStoragePolicy: {
          version: storageWorker.storagePolicyVersion,
          quotaBytes: storageWorker.storageQuotaBytes,
        },
        profileStoragePolicy: {
          profileId,
          version: profile.storagePolicyVersion,
          quotaBytes: profile.storageQuotaBytes,
        },
      })
    } else
      command = control.prepareProfileRuntime(profile.workerId, { action, profileId, generation })
  } catch (error) {
    if (error instanceof WorkerCommandError) throw failure('CONFLICT', error.message)
    throw error
  }
  await tx
    .update(profiles)
    .set({
      runtimeState: action === 'START' ? 'STARTING' : 'STOPPING',
      runtimeDesiredState: action === 'START' ? 'RUNNING' : 'STOPPED',
      runtimeGeneration: generation,
      ...(action === 'START'
        ? {
            runtimeId: command.messageId,
            runtimeRouteVersion: profile.routeVersion,
            runtimeProxyHealth: null,
            runtimeWorkerInstanceId: command.payload.instanceId,
            runtimeObservedAt: null,
            runtimeHealthySince: null,
            runtimeIdleSince: null,
            runtimeRetryAt: null,
          }
        : {}),
      runtimeErrorCode: null,
      runtimeErrorSummary: null,
      updatedAt: sql`now()`,
    })
    .where(eq(profiles.id, profileId))
  await tx.delete(profileRuntimeOutbox).where(eq(profileRuntimeOutbox.profileId, profileId))
  await tx.insert(profileRuntimeOutbox).values({
    id: command.messageId,
    profileId,
    workerId: profile.workerId,
    command,
    expiresAt: command.payload.expiresAt,
  })
  return command
}

function failure(
  code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT',
  message: string,
  statusCode = 409,
): BrowShareError {
  return new BrowShareError({ code, message, statusCode })
}
