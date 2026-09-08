import { readWorkerRuntimeSnapshot } from './worker-runtime-recovery.js'
import { storageBlockReason } from './storage.js'
import { lockSessionPolicyConfiguration } from './session-policy-rules.js'
import { revokeTabSessions } from './session-revocation.js'
import {
  BrowShareError,
  createPublicId,
  decodePageCursor,
  encodePageCursor,
  isPublicId,
  normalizePageLimit,
} from '@browshare/common'
import {
  WorkerCapabilityReportSchema,
  WorkerMetricsSnapshotResponseSchema,
  type SetWorkerStateRequest,
  type UpdateWorkerCapacityRequest,
  type WorkerCapacitySummary,
  type WorkerListQuery,
  type WorkerListResponse,
  type WorkerResponse,
  type WorkerCleanupFailure,
  type WorkerSchedulingBlockReason,
  type WorkerState,
  type StorageBlockReason,
  type WorkerStateResponse,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { profiles, auditEvents, tabSessions, workers } from '@browshare/database/schema'
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { Value } from 'typebox/value'

import type { AuditContext } from './users.js'

export interface WorkerControlStatus {
  readonly instanceId: string | null
  readonly recoveryReady: boolean
  readonly protocolMinor: number | null
  readonly connected: boolean
  readonly ready: boolean
  readonly credentialId: string | null
}

export interface WorkerControlLifecyclePort {
  getWorkerControlStatus(workerId: string): WorkerControlStatus
  disconnectWorker(workerId: string, reason: 'DISABLED' | 'CREDENTIAL_REVOKED' | 'RETIRED'): void
}

export interface WorkerPort {
  list(query: WorkerListQuery): Promise<WorkerListResponse>
  get(workerId: string): Promise<WorkerResponse>
  getState(workerId: string): Promise<WorkerStateResponse>
  setState(
    workerId: string,
    requestedState: SetWorkerStateRequest['state'],
    context: AuditContext,
  ): Promise<WorkerStateResponse>
  updateCapacity(
    workerId: string,
    input: UpdateWorkerCapacityRequest,
    context: AuditContext,
  ): Promise<WorkerResponse>
}

type WorkerRecord = typeof workers.$inferSelect
type WorkerStateRecord = Pick<
  WorkerRecord,
  'id' | 'status' | 'lastSeenAt' | 'disabledAt' | 'updatedAt'
>

export class WorkerService implements WorkerPort {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: WorkerControlLifecyclePort,
  ) {}

  async list(query: WorkerListQuery): Promise<WorkerListResponse> {
    const limit = normalizePageLimit(query.limit)
    const cursor = query.cursor === undefined ? undefined : decodePageCursor(query.cursor)
    const filters: SQL[] = [isNull(workers.deletedAt)]
    if (query.search !== undefined) {
      const searchText = query.search.trim()
      if (searchText.length === 0) {
        throw new BrowShareError({
          code: 'BAD_REQUEST',
          message: 'Search must not be blank.',
          statusCode: 400,
        })
      }
      const search = `%${escapeLike(searchText)}%`
      filters.push(or(ilike(workers.name, search), ilike(workers.reportedHostname, search))!)
    }
    if (query.state !== undefined && query.state !== 'ALL') {
      filters.push(eq(workers.status, query.state))
    }
    if (cursor !== undefined) {
      filters.push(
        or(
          lt(workers.createdAt, cursor.createdAt),
          and(eq(workers.createdAt, cursor.createdAt), lt(workers.id, cursor.id)),
        )!,
      )
    }

    const records = await this.connection.db
      .select()
      .from(workers)
      .where(and(...filters))
      .orderBy(desc(workers.createdAt), desc(workers.id))
      .limit(limit + 1)
    const hasMore = records.length > limit
    const page = records.slice(0, limit)
    const items = await this.hydrate(page)
    const last = page.at(-1)
    return {
      items,
      meta: {
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? encodePageCursor({ id: last.id, createdAt: last.createdAt })
            : null,
      },
    }
  }

  async get(workerId: string): Promise<WorkerResponse> {
    assertWorkerId(workerId)
    const [record] = await this.connection.db
      .select()
      .from(workers)
      .where(and(eq(workers.id, workerId), isNull(workers.deletedAt)))
      .limit(1)
    if (record === undefined) throw workerNotFound()
    return (await this.hydrate([record]))[0]!
  }

  async getState(workerId: string): Promise<WorkerStateResponse> {
    assertWorkerId(workerId)
    const [record] = await this.connection.db
      .select({
        id: workers.id,
        status: workers.status,
        lastSeenAt: workers.lastSeenAt,
        disabledAt: workers.disabledAt,
        updatedAt: workers.updatedAt,
      })
      .from(workers)
      .where(and(eq(workers.id, workerId), isNull(workers.deletedAt)))
      .limit(1)
    if (record === undefined) throw workerNotFound()
    return this.toStateResponse(record)
  }

  async setState(
    workerId: string,
    requestedState: SetWorkerStateRequest['state'],
    context: AuditContext,
  ): Promise<WorkerStateResponse> {
    assertWorkerId(workerId)
    const controlStatus = this.control.getWorkerControlStatus(workerId)
    await this.connection.db.transaction(async (transaction) => {
      await lockSessionPolicyConfiguration(transaction)
      // Reconciliation holds Profile -> Session -> Worker. Lock Profiles before changing Worker.
      await transaction
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.workerId, workerId))
        .orderBy(asc(profiles.id))
        .for('update')
      const [current] = await transaction
        .select({
          status: workers.status,
          lastSnapshotAt: workers.lastSnapshotAt,
        })
        .from(workers)
        .where(and(eq(workers.id, workerId), isNull(workers.deletedAt)))
        .for('update')
        .limit(1)
      if (current === undefined) throw workerNotFound()

      const effectiveState = resolveEffectiveState(
        requestedState,
        controlStatus,
        current.lastSnapshotAt,
      )
      await transaction
        .update(workers)
        .set({
          status: effectiveState,
          disabledAt:
            requestedState === 'DISABLED' ? sql`coalesce(${workers.disabledAt}, now())` : null,
          updatedAt: sql`now()`,
        })
        .where(eq(workers.id, workerId))
      if (requestedState === 'DISABLED')
        await revokeTabSessions(
          transaction,
          eq(tabSessions.workerId, workerId),
          'WORKER_DISABLED',
          context,
          false,
        )
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        action: 'worker.state.set',
        targetType: 'worker',
        targetId: workerId,
        result: 'SUCCEEDED',
        requestId: context.requestId,
        changes: {
          previousState: current.status,
          requestedState,
          effectiveState,
        },
        metadata: {},
      })
    })

    if (requestedState === 'DISABLED') {
      this.control.disconnectWorker(workerId, 'DISABLED')
    }
    return this.getState(workerId)
  }

  async updateCapacity(
    workerId: string,
    input: UpdateWorkerCapacityRequest,
    context: AuditContext,
  ): Promise<WorkerResponse> {
    assertWorkerId(workerId)
    await this.connection.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          maxActiveTabs: workers.maxActiveTabs,
          storageQuotaBytes: workers.storageQuotaBytes,
        })
        .from(workers)
        .where(and(eq(workers.id, workerId), isNull(workers.deletedAt)))
        .for('update')
        .limit(1)
      if (current === undefined) throw workerNotFound()
      await transaction
        .update(workers)
        .set({
          ...(input.maxActiveTabs === undefined ? {} : { maxActiveTabs: input.maxActiveTabs }),
          ...(input.storageQuotaBytes === undefined
            ? {}
            : {
                storageQuotaBytes: input.storageQuotaBytes,
                storagePolicyVersion:
                  current.storageQuotaBytes !== input.storageQuotaBytes
                    ? sql`${workers.storagePolicyVersion} + 1`
                    : workers.storagePolicyVersion,
              }),
          updatedAt: sql`now()`,
        })
        .where(eq(workers.id, workerId))
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: context.actorUserId,
        action: 'worker.capacity.update',
        targetType: 'worker',
        targetId: workerId,
        result: 'SUCCEEDED',
        requestId: context.requestId,
        changes: {
          previousMaxActiveTabs: current.maxActiveTabs,
          ...input,
        },
        metadata: {},
      })
    })
    return this.get(workerId)
  }

  private async hydrate(records: readonly WorkerRecord[]): Promise<WorkerResponse[]> {
    if (records.length === 0) return []
    const activeCounts = await this.connection.db
      .select({ workerId: tabSessions.workerId, activeTabs: count() })
      .from(tabSessions)
      .where(
        and(
          inArray(
            tabSessions.workerId,
            records.map(({ id }) => id),
          ),
          notInArray(tabSessions.status, ['CLOSED', 'FAILED']),
        ),
      )
      .groupBy(tabSessions.workerId)
    const activeTabsByWorker = new Map(
      activeCounts.map(({ workerId, activeTabs }) => [workerId, activeTabs]),
    )

    const cleanupFailures = await this.loadCleanupFailures(records)
    return records.map((record) => {
      const controlStatus = this.control.getWorkerControlStatus(record.id)
      const capacity = summarizeWorkerCapacity(
        record.maxActiveTabs,
        activeTabsByWorker.get(record.id) ?? 0,
      )
      const schedulingBlockReasons = workerSchedulingBlocks(
        record.status,
        controlStatus,
        capacity,
        storageBlockReason(record),
      )
      return {
        storageQuotaBytes: record.storageQuotaBytes,
        storagePolicyVersion: record.storagePolicyVersion,
        storageSnapshot: record.storageSnapshot,
        storagePolicyPending:
          record.storageSnapshot?.appliedPolicyVersion !== record.storagePolicyVersion,
        id: record.id,
        name: record.name,
        reportedHostname: record.reportedHostname,
        platform: record.platform,
        architecture: record.architecture,
        state: record.status,
        controlConnected: controlStatus.connected,
        controlReady: controlStatus.ready,
        cleanupFailures: cleanupFailures.get(record.id) ?? [],
        workerEligible: schedulingBlockReasons.length === 0,
        schedulingBlockReasons,
        capacity,
        versions: sanitizeVersions(record.versions),
        capabilityReport: Value.Check(WorkerCapabilityReportSchema, record.capabilities)
          ? record.capabilities
          : null,
        metricsSnapshot: Value.Check(WorkerMetricsSnapshotResponseSchema, record.metricsSnapshot)
          ? record.metricsSnapshot
          : null,
        lastProbeErrorCode: record.lastProbeErrorCode,
        lastProbeErrorSummary: record.lastProbeErrorSummary,
        lastSeenAt: toNullableIsoTimestamp(record.lastSeenAt),
        lastSnapshotAt: toNullableIsoTimestamp(record.lastSnapshotAt),
        disabledAt: toNullableIsoTimestamp(record.disabledAt),
        createdAt: toIsoTimestamp(record.createdAt),
        updatedAt: toIsoTimestamp(record.updatedAt),
      }
    })
  }

  private async loadCleanupFailures(
    records: readonly WorkerRecord[],
  ): Promise<Map<string, WorkerCleanupFailure[]>> {
    const snapshots = records.map((record) => ({
      workerId: record.id,
      snapshot: readWorkerRuntimeSnapshot(record.runtimeSnapshot),
    }))
    const profileIds = [
      ...new Set(
        snapshots.flatMap(
          ({ snapshot }) =>
            snapshot?.profiles.filter((fact) => fact.cleanupError).map((fact) => fact.profileId) ??
            [],
        ),
      ),
    ]
    const sessionIds = [
      ...new Set(
        snapshots.flatMap(
          ({ snapshot }) =>
            snapshot?.sessions.filter((fact) => fact.cleanupError).map((fact) => fact.sessionId) ??
            [],
        ),
      ),
    ]
    const [profileRows, sessionRows] = await Promise.all([
      profileIds.length
        ? this.connection.db
            .select({
              id: profiles.id,
              workerId: profiles.workerId,
              runtimeId: profiles.runtimeId,
              generation: profiles.runtimeGeneration,
              instanceId: profiles.runtimeWorkerInstanceId,
            })
            .from(profiles)
            .where(and(inArray(profiles.id, profileIds), isNull(profiles.deletedAt)))
        : [],
      sessionIds.length
        ? this.connection.db
            .select({
              id: tabSessions.id,
              tabId: tabSessions.tabId,
              targetId: tabSessions.targetId,
              profileId: tabSessions.profileId,
              workerId: tabSessions.workerId,
              runtimeId: tabSessions.runtimeId,
              generation: tabSessions.profileGeneration,
              instanceId: tabSessions.workerInstanceId,
            })
            .from(tabSessions)
            .where(inArray(tabSessions.id, sessionIds))
        : [],
    ])
    const profilesById = new Map(profileRows.map((row) => [row.id, row]))
    const sessionsById = new Map(sessionRows.map((row) => [row.id, row]))
    return new Map(
      snapshots.map(({ workerId, snapshot }) => {
        const failures: WorkerCleanupFailure[] = []
        for (const fact of snapshot?.profiles ?? []) {
          if (!fact.cleanupError) continue
          const row = profilesById.get(fact.profileId)
          failures.push({
            scope: 'PROFILE',
            profileId: fact.profileId,
            runtimeId: fact.runtimeId,
            generation: fact.generation,
            sessionId: null,
            error: fact.cleanupError,
            registered:
              row !== undefined &&
              row.workerId === workerId &&
              row.runtimeId === fact.runtimeId &&
              row.generation === fact.generation &&
              row.instanceId === snapshot!.instanceId,
          })
        }
        for (const fact of snapshot?.sessions ?? []) {
          if (!fact.cleanupError) continue
          const row = sessionsById.get(fact.sessionId)
          failures.push({
            scope: 'SESSION',
            profileId: fact.profileId,
            runtimeId: fact.runtimeId,
            generation: fact.profileGeneration,
            sessionId: fact.sessionId,
            error: fact.cleanupError,
            registered:
              row !== undefined &&
              row.workerId === workerId &&
              row.profileId === fact.profileId &&
              row.tabId === fact.tabId &&
              row.targetId === fact.targetId &&
              row.runtimeId === fact.runtimeId &&
              row.generation === fact.profileGeneration &&
              row.instanceId === snapshot!.instanceId,
          })
        }
        return [workerId, failures]
      }),
    )
  }

  private toStateResponse(record: WorkerStateRecord): WorkerStateResponse {
    const controlStatus = this.control.getWorkerControlStatus(record.id)
    return {
      workerId: record.id,
      state: record.status,
      controlConnected: controlStatus.connected,
      controlReady: controlStatus.ready,
      lastSeenAt: toNullableIsoTimestamp(record.lastSeenAt),
      disabledAt: toNullableIsoTimestamp(record.disabledAt),
      updatedAt: toIsoTimestamp(record.updatedAt),
    }
  }
}

export function summarizeWorkerCapacity(
  maxActiveTabs: number | null,
  activeTabs: number,
): WorkerCapacitySummary {
  if (maxActiveTabs === null) {
    return { maxActiveTabs, activeTabs, availableTabs: null, state: 'UNLIMITED' }
  }
  const availableTabs = Math.max(0, maxActiveTabs - activeTabs)
  const state =
    activeTabs > maxActiveTabs ? 'OVER_LIMIT' : activeTabs === maxActiveTabs ? 'FULL' : 'AVAILABLE'
  return { maxActiveTabs, activeTabs, availableTabs, state }
}

export function workerSchedulingBlocks(
  state: WorkerState,
  control: WorkerControlStatus,
  capacity: WorkerCapacitySummary,
  storageReason: StorageBlockReason | null = null,
): WorkerSchedulingBlockReason[] {
  const reasons: WorkerSchedulingBlockReason[] = []
  if (storageReason) reasons.push('STORAGE_BLOCKED')
  if (state !== 'ONLINE') reasons.push('STATE_NOT_ONLINE')
  if (!control.ready) reasons.push('CONTROL_NOT_READY')
  if (capacity.state === 'FULL' || capacity.state === 'OVER_LIMIT') {
    reasons.push('CAPACITY_REACHED')
  }
  return reasons
}

function sanitizeVersions(value: Readonly<Record<string, unknown>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 &&
        entry[0].length <= 64 &&
        typeof entry[1] === 'string' &&
        entry[1].length > 0 &&
        entry[1].length <= 128,
    ),
  )
}

function resolveEffectiveState(
  requestedState: SetWorkerStateRequest['state'],
  controlStatus: WorkerControlStatus,
  lastSnapshotAt: string | null,
): WorkerState {
  if (requestedState === 'DRAINING') return 'DRAINING'
  if (requestedState === 'DISABLED') return 'DISABLED'
  if (controlStatus.ready) return 'ONLINE'
  if (controlStatus.connected || lastSnapshotAt === null) return 'PENDING'
  return 'OFFLINE'
}

function assertWorkerId(workerId: string): void {
  if (!isPublicId(workerId)) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: 'Worker ID must be a UUIDv7.',
      statusCode: 400,
    })
  }
}

function workerNotFound(): BrowShareError {
  return new BrowShareError({
    code: 'NOT_FOUND',
    message: 'The Worker does not exist.',
    statusCode: 404,
  })
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function toIsoTimestamp(value: string): string {
  return new Date(value).toISOString()
}

function toNullableIsoTimestamp(value: string | null): string | null {
  return value === null ? null : toIsoTimestamp(value)
}
