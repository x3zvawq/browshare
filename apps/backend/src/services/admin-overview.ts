import { storageBlockReason } from './storage.js'
import { BrowShareError } from '@browshare/common'
import type {
  AdminOverview,
  ProfileOverview,
  SessionOverview,
  WorkerOverview,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { profiles, tabSessions, workers } from '@browshare/database/schema'
import { count, eq, isNull, notInArray, sql } from 'drizzle-orm'
import { ProfileService } from './profiles.js'
import {
  summarizeWorkerCapacity,
  workerSchedulingBlocks,
  type WorkerControlLifecyclePort,
} from './workers.js'

export class AdminOverviewService {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: Pick<WorkerControlLifecyclePort, 'getWorkerControlStatus'>,
  ) {}

  async get(permissionCodes: readonly string[]): Promise<AdminOverview> {
    const canReadWorkers = permissionCodes.includes('worker.read')
    const canReadProfiles = permissionCodes.includes('profile.read')
    if (!canReadWorkers && !canReadProfiles) {
      throw new BrowShareError({
        code: 'FORBIDDEN',
        statusCode: 403,
        message: 'Worker or Profile read permission is required for the administration overview.',
      })
    }
    const [workerSummary, profileSummary, sessionSummary] = await Promise.all([
      canReadWorkers ? this.workers() : null,
      canReadProfiles ? this.profiles() : null,
      canReadProfiles ? this.sessions() : null,
    ])
    return {
      observedAt: new Date().toISOString(),
      workers: workerSummary,
      profiles: profileSummary,
      sessions: sessionSummary,
      unavailableReasons: {
        workers: canReadWorkers ? null : 'MISSING_WORKER_READ',
        profiles: canReadProfiles ? null : 'MISSING_PROFILE_READ',
        sessions: canReadProfiles ? null : 'MISSING_PROFILE_READ',
      },
    }
  }

  private async workers(): Promise<WorkerOverview> {
    const activeCounts = this.connection.db
      .select({ workerId: tabSessions.workerId, activeTabs: count().as('active_tabs') })
      .from(tabSessions)
      .where(notInArray(tabSessions.status, ['CLOSED', 'FAILED']))
      .groupBy(tabSessions.workerId)
      .as('overview_active_tabs')
    const rows = await this.connection.db
      .select({
        storageQuotaBytes: workers.storageQuotaBytes,
        storagePolicyVersion: workers.storagePolicyVersion,
        storageSnapshot: workers.storageSnapshot,
        id: workers.id,
        state: workers.status,
        maxActiveTabs: workers.maxActiveTabs,
        activeTabs: sql<number>`coalesce(${activeCounts.activeTabs}, 0)::integer`,
      })
      .from(workers)
      .leftJoin(activeCounts, eq(activeCounts.workerId, workers.id))
      .where(isNull(workers.deletedAt))
    const result: WorkerOverview = {
      storage: {
        lowDiskWorkers: 0,
        criticalDiskWorkers: 0,
        quotaExceededWorkers: 0,
        unknownWorkers: 0,
      },
      totalWorkers: rows.length,
      states: { pending: 0, online: 0, draining: 0, offline: 0, disabled: 0 },
      connectedWorkers: 0,
      readyWorkers: 0,
      eligibleWorkers: 0,
      capacity: {
        activeTabs: 0,
        finiteTabLimit: 0,
        availableTabs: 0,
        unlimitedWorkers: 0,
        fullWorkers: 0,
        overLimitWorkers: 0,
        schedulableAvailableTabs: 0,
        schedulableUnlimitedWorkers: 0,
      },
    }
    // Control readiness is process state; every non-retired Worker must be evaluated, not one list page.
    for (const row of rows) {
      const control = this.control.getWorkerControlStatus(row.id)
      const capacity = summarizeWorkerCapacity(row.maxActiveTabs, row.activeTabs)
      const eligible =
        workerSchedulingBlocks(row.state, control, capacity, storageBlockReason(row)).length === 0
      result.states[row.state.toLowerCase() as keyof WorkerOverview['states']] += 1
      if (control.connected) result.connectedWorkers += 1
      if (control.ready) result.readyWorkers += 1
      if (eligible) result.eligibleWorkers += 1
      result.storage.lowDiskWorkers += Number(row.storageSnapshot?.diskState === 'LOW_DISK')
      result.storage.criticalDiskWorkers += Number(
        row.storageSnapshot?.diskState === 'CRITICAL_DISK',
      )
      result.storage.quotaExceededWorkers += Number(
        row.storageQuotaBytes === 0 ||
          (row.storageSnapshot?.appliedPolicyVersion === row.storagePolicyVersion &&
            row.storageSnapshot?.quotaState === 'EXCEEDED'),
      )
      result.storage.unknownWorkers += Number(
        !row.storageSnapshot ||
          row.storageSnapshot.diskState === 'UNKNOWN' ||
          row.storageSnapshot.quotaState === 'UNKNOWN',
      )
      result.capacity.activeTabs += capacity.activeTabs
      if (capacity.maxActiveTabs === null) {
        result.capacity.unlimitedWorkers += 1
        if (eligible) result.capacity.schedulableUnlimitedWorkers += 1
      } else {
        result.capacity.finiteTabLimit += capacity.maxActiveTabs
        result.capacity.availableTabs += capacity.availableTabs!
        if (eligible) result.capacity.schedulableAvailableTabs += capacity.availableTabs!
      }
      if (capacity.state === 'FULL') result.capacity.fullWorkers += 1
      if (capacity.state === 'OVER_LIMIT') result.capacity.overLimitWorkers += 1
    }
    return result
  }

  private async profiles(): Promise<ProfileOverview> {
    const [summary, [route]] = await Promise.all([
      new ProfileService(this.connection, this.control).getSummary(),
      this.connection.db
        .select({
          storageQuotaExceededProfiles: sql<number>`count(*) filter (where ${profiles.storageQuotaBytes}=0 or ((${profiles.storageUsage}->>'appliedPolicyVersion')::integer=${profiles.storagePolicyVersion} and ${profiles.storageUsage}->>'quotaState'='EXCEEDED'))::integer`,
          storageUnknownProfiles: sql<number>`count(*) filter (where ${profiles.storageUsage} is null or ${profiles.storageUsage}->>'quotaState'='UNKNOWN')::integer`,
          deletingProfiles: sql<number>`count(*) filter (where ${profiles.deleteRequestedAt} is not null)::integer`,
          restartRequiredProfiles: sql<number>`count(*) filter (where ${profiles.runtimeRouteVersion} is not null and ${profiles.runtimeRouteVersion} <> ${profiles.routeVersion})::integer`,
          unhealthyRuntimes: sql<number>`count(*) filter (where ${profiles.runtimeState} in ('RUNNING', 'MAINTAINING') and ${profiles.runtimeProxyHealth}->>'status' = 'UNHEALTHY')::integer`,
          unknownRuntimeHealth: sql<number>`count(*) filter (where ${profiles.runtimeState} in ('RUNNING', 'MAINTAINING') and ${profiles.runtimeProxyHealth} is null)::integer`,
        })
        .from(profiles)
        .where(isNull(profiles.deletedAt)),
    ])
    if (!route) throw new Error('Profile overview query returned no row')
    return { ...summary, ...route }
  }

  private async sessions(): Promise<SessionOverview> {
    const rows = await this.connection.db
      .select({
        kind: tabSessions.kind,
        state: tabSessions.status,
        count: count(),
      })
      .from(tabSessions)
      .where(notInArray(tabSessions.status, ['CLOSED', 'FAILED']))
      .groupBy(tabSessions.kind, tabSessions.status)
    const result: SessionOverview = {
      activeSessions: 0,
      normalSessions: 0,
      maintenanceSessions: 0,
      states: {
        reserved: 0,
        creating: 0,
        ready: 0,
        connected: 0,
        suspended: 0,
        disconnected: 0,
        closing: 0,
      },
    }
    for (const row of rows) {
      result.activeSessions += row.count
      if (row.kind === 'NORMAL') result.normalSessions += row.count
      else result.maintenanceSessions += row.count
      result.states[row.state.toLowerCase() as keyof SessionOverview['states']] += row.count
    }
    return result
  }
}
