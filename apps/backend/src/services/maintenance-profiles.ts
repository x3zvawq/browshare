import { profileStorageColumns, profileStorageSummary } from './storage.js'
import {
  BrowShareError,
  decodePageCursor,
  encodePageCursor,
  isPublicId,
  normalizePageLimit,
} from '@browshare/common'
import type { MaintenanceProfile, MaintenanceProfileListQuery } from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { profiles, tabSessions, users, workers } from '@browshare/database/schema'
import { and, desc, eq, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { escapeLike } from './search.js'
import type { WorkerControlServer } from './worker-control-server.js'

const maintenance = alias(tabSessions, 'maintenance')

/** Minimum operating context for profile.maintain; no general Profile/Worker/Proxy directory access. */
export class MaintenanceProfileService {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: Pick<WorkerControlServer, 'getWorkerControlStatus'>,
  ) {}

  private query() {
    return this.connection.db
      .select({
        id: profiles.id,
        name: profiles.name,
        description: profiles.description,
        businessStatus: profiles.businessStatus,
        runtimeState: profiles.runtimeState,
        ...profileStorageColumns,
        routeVersion: profiles.routeVersion,
        runtimeRouteVersion: profiles.runtimeRouteVersion,
        runtimeProxyHealth: profiles.runtimeProxyHealth,
        runtimeMode: profiles.runtimeMode,
        runtimeDesiredState: profiles.runtimeDesiredState,
        healthcheckUrl: profiles.healthcheckUrl,
        createdAt: profiles.createdAt,
        workerId: workers.id,
        workerState: workers.status,
        workerDisabledAt: workers.disabledAt,
        workerDeletedAt: workers.deletedAt,
        activeNormalSessions: sql<number>`(select count(*)::integer from ${tabSessions} where ${tabSessions.profileId}=${profiles.id} and ${tabSessions.kind}='NORMAL' and ${tabSessions.status} not in ('CLOSED', 'FAILED'))`,
        sessionId: maintenance.id,
        ownerId: maintenance.userId,
        ownerName: users.displayName,
        sessionStatus: maintenance.status,
      })
      .from(profiles)
      .innerJoin(workers, eq(workers.id, profiles.workerId))
      .leftJoin(
        maintenance,
        and(
          eq(maintenance.profileId, profiles.id),
          eq(maintenance.kind, 'MAINTENANCE'),
          isNull(maintenance.maintenanceReleasedAt),
        ),
      )
      .leftJoin(users, eq(users.id, maintenance.userId))
  }

  async list(userId: string, query: MaintenanceProfileListQuery) {
    const filters: SQL[] = [isNull(profiles.deletedAt), isNull(profiles.deleteRequestedAt)]
    const search = query.search?.trim()
    if (search)
      filters.push(
        or(
          ilike(profiles.name, `%${escapeLike(search)}%`),
          ilike(profiles.description, `%${escapeLike(search)}%`),
        )!,
      )
    if (query.cursor) {
      const cursor = decodePageCursor(query.cursor)
      filters.push(
        or(
          lt(profiles.createdAt, cursor.createdAt),
          and(eq(profiles.createdAt, cursor.createdAt), lt(profiles.id, cursor.id)),
        )!,
      )
    }
    const limit = normalizePageLimit(query.limit)
    const rows = await this.query()
      .where(and(...filters))
      .orderBy(desc(profiles.createdAt), desc(profiles.id))
      .limit(limit + 1)
    const items = rows.slice(0, limit).map((row) => this.toProfile(userId, row)),
      last = items.at(-1),
      hasMore = rows.length > limit
    return {
      items,
      meta: {
        hasMore,
        nextCursor:
          hasMore && last ? encodePageCursor({ id: last.id, createdAt: last.createdAt }) : null,
      },
    }
  }

  async get(userId: string, id: string): Promise<MaintenanceProfile> {
    if (!isPublicId(id))
      throw new BrowShareError({
        code: 'BAD_REQUEST',
        message: 'Profile ID must be a UUIDv7.',
        statusCode: 400,
      })
    const [row] = await this.query().where(
      and(eq(profiles.id, id), isNull(profiles.deletedAt), isNull(profiles.deleteRequestedAt)),
    )
    if (!row)
      throw new BrowShareError({
        code: 'NOT_FOUND',
        message: 'Profile does not exist.',
        statusCode: 404,
      })
    return this.toProfile(userId, row)
  }

  private toProfile(
    userId: string,
    row: Awaited<ReturnType<MaintenanceProfileService['query']>>[number],
  ): MaintenanceProfile {
    const live = this.control.getWorkerControlStatus(row.workerId)
    let blockedReason: MaintenanceProfile['blockedReason'] = null
    if (row.sessionId !== null) blockedReason = 'PROFILE_MAINTENANCE_ACTIVE'
    else if (row.businessStatus !== 'ENABLED') blockedReason = 'PROFILE_DISABLED'
    else if (
      row.workerState !== 'ONLINE' ||
      row.workerDisabledAt !== null ||
      row.workerDeletedAt !== null ||
      !live.connected ||
      !live.ready
    )
      blockedReason = 'WORKER_UNAVAILABLE'
    else if (live.protocolMinor === null || live.protocolMinor < 19)
      blockedReason = 'WORKER_PROTOCOL_INCOMPATIBLE'
    else if (row.healthcheckUrl === null) blockedReason = 'PROFILE_HEALTHCHECK_REQUIRED'
    else if (
      !['RUNNING', 'STOPPED', 'STARTING', 'ERROR'].includes(row.runtimeState) ||
      (row.runtimeDesiredState === 'STOPPED' && row.runtimeState !== 'STOPPED') ||
      (row.runtimeState === 'RUNNING' && row.runtimeProxyHealth?.status !== 'HEALTHY') ||
      row.storageBlockedReason !== null
    )
      blockedReason = 'PROFILE_NOT_READY'
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      businessStatus: row.businessStatus,
      runtimeState: row.runtimeState,
      ...profileStorageSummary(row),
      routeVersion: row.routeVersion,
      runtimeRouteVersion: row.runtimeRouteVersion,
      runtimeProxyHealth: row.runtimeProxyHealth,
      restartRequired:
        row.runtimeRouteVersion !== null && row.runtimeRouteVersion !== row.routeVersion,
      runtimeMode: row.runtimeMode,
      defaultInitialUrl: row.healthcheckUrl,
      activeNormalSessions: row.activeNormalSessions,
      createdAt: new Date(row.createdAt).toISOString(),
      blockedReason,
      maintenance:
        row.sessionId === null
          ? null
          : {
              sessionId: row.ownerId === userId ? row.sessionId : null,
              ownerName: row.ownerName!,
              status: row.sessionStatus!,
            },
    }
  }
}
