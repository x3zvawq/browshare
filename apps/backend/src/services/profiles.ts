import { profileRuntimeRecovery } from './worker-runtime-recovery.js'
import type { WorkerControlLifecyclePort } from './workers.js'
import { profileStorageColumns, profileStorageSummary } from './storage.js'
import { lockSessionPolicyConfiguration } from './session-policy-rules.js'
import { revokeTabSessions } from './session-revocation.js'
import { escapeLike } from './search.js'
import { profileAccessCondition } from './profile-access.js'
import { normalizeHealthcheckUrl } from './healthcheck-url.js'
import {
  BrowShareError,
  createPublicId,
  decodePageCursor,
  encodePageCursor,
  isPublicId,
  normalizePageLimit,
} from '@browshare/common'
import type {
  AccessibleProfile,
  AccessibleProfileListResponse,
  CreateProfileRequest,
  ProfileCapacitySummary,
  StorageBlockReason,
  ProfileGroupSummary,
  ProfileListQuery,
  ProfileListResponse,
  ProfileListSummary,
  ProfileProxySummary,
  ProfileResponse,
  SetProfileBusinessStateRequest,
  UpdateProfileRequest,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  profileGroupMembers,
  profileGroups,
  profiles,
  proxies,
  tabSessions,
  workers,
} from '@browshare/database/schema'
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

import { isPostgresUniqueViolation } from './database-errors.js'

export interface ProfileAuditContext {
  readonly actorUserId: string
  readonly requestId?: string
}

export interface ProfilePort {
  listAccessible(userId: string, query: ProfileListQuery): Promise<AccessibleProfileListResponse>
  getAccessible(userId: string, profileId: string): Promise<AccessibleProfile>
  list(query: ProfileListQuery): Promise<ProfileListResponse>
  get(profileId: string): Promise<ProfileResponse>
  create(input: CreateProfileRequest, context: ProfileAuditContext): Promise<ProfileResponse>
  update(
    profileId: string,
    input: UpdateProfileRequest,
    context: ProfileAuditContext,
  ): Promise<ProfileResponse>
  setState(
    profileId: string,
    state: SetProfileBusinessStateRequest['state'],
    context: ProfileAuditContext,
  ): Promise<ProfileResponse>
  requestDeletion(
    profileId: string,
    expectedName: string,
    context: ProfileAuditContext,
  ): Promise<ProfileResponse>
}

type ProfileRecord = Omit<
  typeof profiles.$inferSelect,
  | 'runtimeDesiredState'
  | 'runtimeObservedAt'
  | 'runtimeIdleSince'
  | 'runtimeHealthySince'
  | 'runtimeFailureGeneration'
  | 'dataInitialized'
>

interface ProfileListRecord extends ProfileRecord {
  readonly storagePolicyPending: boolean
  readonly storageBlockedReason: StorageBlockReason | null
  readonly workerRuntimeSnapshot: unknown
  readonly workerDeletedAt: string | null
  readonly workerName: string
  readonly workerState: (typeof workers.$inferSelect)['status']
  readonly proxyName: string | null
  readonly proxyType: (typeof proxies.$inferSelect)['type'] | null
  readonly proxyHealthStatus: (typeof proxies.$inferSelect)['healthStatus'] | null
  readonly activeSessions: number
}

export class ProfileService implements ProfilePort {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: Pick<WorkerControlLifecyclePort, 'getWorkerControlStatus'>,
  ) {}

  async list(query: ProfileListQuery, accessFilter?: SQL): Promise<ProfileListResponse> {
    const limit = normalizePageLimit(query.limit)
    const cursor = query.cursor === undefined ? undefined : decodePageCursor(query.cursor)
    assertOptionalPublicId(query.workerId, 'Worker')
    assertOptionalPublicId(query.groupId, 'Profile Group')

    const filters = this.buildFilters(query)
    if (accessFilter) filters.push(accessFilter)
    const activeSessionCounts = buildActiveSessionCounts(this.connection)

    const pageFilters = [...filters]
    if (cursor !== undefined) {
      pageFilters.push(
        or(
          lt(profiles.createdAt, cursor.createdAt),
          and(eq(profiles.createdAt, cursor.createdAt), lt(profiles.id, cursor.id)),
        )!,
      )
    }

    const [records, summary, facets] = await Promise.all([
      this.connection.db
        .select({
          id: profiles.id,
          name: profiles.name,
          description: profiles.description,
          workerId: profiles.workerId,
          proxyId: profiles.proxyId,
          visibility: profiles.visibility,
          businessStatus: profiles.businessStatus,
          runtimeState: profiles.runtimeState,
          runtimeMode: profiles.runtimeMode,
          runtimeIdleTimeoutSeconds: profiles.runtimeIdleTimeoutSeconds,
          runtimeFailureCount: profiles.runtimeFailureCount,
          runtimeRetryAt: profiles.runtimeRetryAt,
          runtimeGeneration: profiles.runtimeGeneration,
          runtimeId: profiles.runtimeId,
          runtimeWorkerInstanceId: profiles.runtimeWorkerInstanceId,
          ...profileStorageColumns,
          routeVersion: profiles.routeVersion,
          runtimeRouteVersion: profiles.runtimeRouteVersion,
          runtimeProxyHealth: profiles.runtimeProxyHealth,
          healthcheckUrl: profiles.healthcheckUrl,
          runtimeErrorCode: profiles.runtimeErrorCode,
          runtimeErrorSummary: profiles.runtimeErrorSummary,
          maxNormalSessions: profiles.maxNormalSessions,
          tabAudioEnabled: profiles.tabAudioEnabled,
          qualityPolicy: profiles.qualityPolicy,
          viewerFocusPolicy: profiles.viewerFocusPolicy,
          deletedAt: profiles.deletedAt,
          deleteRequestedAt: profiles.deleteRequestedAt,
          createdAt: profiles.createdAt,
          updatedAt: profiles.updatedAt,
          workerName: workers.name,
          workerState: workers.status,
          workerRuntimeSnapshot: workers.runtimeSnapshot,
          workerDeletedAt: workers.deletedAt,
          proxyName: proxies.name,
          proxyType: proxies.type,
          proxyHealthStatus: proxies.healthStatus,
          activeSessions: sql<number>`coalesce(${activeSessionCounts.activeSessions}, 0)::integer`,
        })
        .from(profiles)
        .innerJoin(workers, eq(workers.id, profiles.workerId))
        .leftJoin(proxies, and(eq(proxies.id, profiles.proxyId), isNull(proxies.deletedAt)))
        .leftJoin(activeSessionCounts, eq(activeSessionCounts.profileId, profiles.id))
        .where(and(...pageFilters))
        .orderBy(desc(profiles.createdAt), desc(profiles.id))
        .limit(limit + 1),
      this.loadSummary(filters),
      this.loadFacets(),
    ])

    const hasMore = records.length > limit
    const page = records.slice(0, limit)
    const groupsByProfile = await this.loadGroups(page.map(({ id }) => id))
    const items = page.map((record) =>
      this.toResponse(record, groupsByProfile.get(record.id) ?? []),
    )
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
      summary,
      facets,
    }
  }

  async listAccessible(
    userId: string,
    query: ProfileListQuery,
  ): Promise<AccessibleProfileListResponse> {
    assertPublicId(userId, 'User')
    const result = await this.list(query, profileAccessCondition(userId))
    return { items: result.items.map(toAccessibleProfile), meta: result.meta }
  }

  async getAccessible(userId: string, profileId: string): Promise<AccessibleProfile> {
    assertPublicId(userId, 'User')
    assertPublicId(profileId, 'Profile')
    const result = await this.list(
      { limit: 1 },
      and(profileAccessCondition(userId), eq(profiles.id, profileId)),
    )
    const profile = result.items[0]
    if (!profile)
      throw new BrowShareError({
        code: 'NOT_FOUND',
        message: 'Profile is not available.',
        statusCode: 404,
      })
    return toAccessibleProfile(profile)
  }

  async get(profileId: string): Promise<ProfileResponse> {
    return this.readProfile(profileId)
  }

  private async readProfile(profileId: string, includeDeleted = false): Promise<ProfileResponse> {
    assertPublicId(profileId, 'Profile')
    const activeSessionCounts = buildActiveSessionCounts(this.connection)
    const [record] = await this.connection.db
      .select({
        id: profiles.id,
        name: profiles.name,
        description: profiles.description,
        workerId: profiles.workerId,
        proxyId: profiles.proxyId,
        visibility: profiles.visibility,
        businessStatus: profiles.businessStatus,
        runtimeState: profiles.runtimeState,
        runtimeMode: profiles.runtimeMode,
        runtimeIdleTimeoutSeconds: profiles.runtimeIdleTimeoutSeconds,
        runtimeFailureCount: profiles.runtimeFailureCount,
        runtimeRetryAt: profiles.runtimeRetryAt,
        runtimeGeneration: profiles.runtimeGeneration,
        runtimeId: profiles.runtimeId,
        runtimeWorkerInstanceId: profiles.runtimeWorkerInstanceId,
        ...profileStorageColumns,
        routeVersion: profiles.routeVersion,
        runtimeRouteVersion: profiles.runtimeRouteVersion,
        runtimeProxyHealth: profiles.runtimeProxyHealth,
        healthcheckUrl: profiles.healthcheckUrl,
        runtimeErrorCode: profiles.runtimeErrorCode,
        runtimeErrorSummary: profiles.runtimeErrorSummary,
        maxNormalSessions: profiles.maxNormalSessions,
        tabAudioEnabled: profiles.tabAudioEnabled,
        qualityPolicy: profiles.qualityPolicy,
        viewerFocusPolicy: profiles.viewerFocusPolicy,
        deletedAt: profiles.deletedAt,
        deleteRequestedAt: profiles.deleteRequestedAt,
        createdAt: profiles.createdAt,
        updatedAt: profiles.updatedAt,
        workerName: workers.name,
        workerState: workers.status,
        workerRuntimeSnapshot: workers.runtimeSnapshot,
        workerDeletedAt: workers.deletedAt,
        proxyName: proxies.name,
        proxyType: proxies.type,
        proxyHealthStatus: proxies.healthStatus,
        activeSessions: sql<number>`coalesce(${activeSessionCounts.activeSessions}, 0)::integer`,
      })
      .from(profiles)
      .innerJoin(workers, eq(workers.id, profiles.workerId))
      .leftJoin(proxies, and(eq(proxies.id, profiles.proxyId), isNull(proxies.deletedAt)))
      .leftJoin(activeSessionCounts, eq(activeSessionCounts.profileId, profiles.id))
      .where(
        and(eq(profiles.id, profileId), includeDeleted ? undefined : isNull(profiles.deletedAt)),
      )
      .limit(1)
    if (record === undefined) throw profileNotFound()
    const groupsByProfile = await this.loadGroups([profileId])
    return this.toResponse(record, groupsByProfile.get(profileId) ?? [])
  }

  async create(
    input: CreateProfileRequest,
    context: ProfileAuditContext,
  ): Promise<ProfileResponse> {
    assertPublicId(input.workerId, 'Worker')
    assertOptionalNullablePublicId(input.proxyId, 'Proxy')
    const profileId = createPublicId()
    const values = {
      id: profileId,
      storageQuotaBytes: input.storageQuotaBytes ?? null,
      name: normalizeProfileName(input.name),
      description: normalizeDescription(input.description),
      workerId: input.workerId,
      proxyId: input.proxyId,
      healthcheckUrl: normalizeHealthcheckUrl(input.healthcheckUrl ?? null),
      visibility: input.visibility,
      runtimeMode: input.runtimeMode,
      runtimeIdleTimeoutSeconds: input.runtimeIdleTimeoutSeconds ?? 300,
      maxNormalSessions: input.maxNormalSessions,
      tabAudioEnabled: input.tabAudioEnabled,
      qualityPolicy: input.qualityPolicy,
      viewerFocusPolicy: input.viewerFocusPolicy ?? null,
    }

    try {
      await this.connection.db.transaction(async (transaction) => {
        const [worker] = await transaction
          .select({ id: workers.id })
          .from(workers)
          .where(and(eq(workers.id, input.workerId), isNull(workers.deletedAt)))
          .limit(1)
        if (worker === undefined) {
          throw new BrowShareError({
            code: 'NOT_FOUND',
            message: 'The selected Worker does not exist.',
            statusCode: 404,
          })
        }
        await assertActiveProxy(transaction, input.proxyId)
        await transaction.insert(profiles).values(values)
        await writeProfileAudit(transaction, context, {
          action: 'profile.create',
          targetId: profileId,
          changes: values,
        })
      })
    } catch (cause) {
      if (isPostgresUniqueViolation(cause)) throw profileNameConflict(cause)
      throw cause
    }
    return this.get(profileId)
  }

  async update(
    profileId: string,
    input: UpdateProfileRequest,
    context: ProfileAuditContext,
  ): Promise<ProfileResponse> {
    assertPublicId(profileId, 'Profile')
    if ('proxyId' in input) assertOptionalNullablePublicId(input.proxyId, 'Proxy')
    const changes: Partial<typeof profiles.$inferInsert> = {
      ...(input.storageQuotaBytes === undefined
        ? {}
        : { storageQuotaBytes: input.storageQuotaBytes }),
      ...(input.healthcheckUrl === undefined
        ? {}
        : { healthcheckUrl: normalizeHealthcheckUrl(input.healthcheckUrl) }),
      ...(input.name === undefined ? {} : { name: normalizeProfileName(input.name) }),
      ...(!('description' in input)
        ? {}
        : { description: normalizeDescription(input.description ?? null) }),
      ...(!('proxyId' in input) ? {} : { proxyId: input.proxyId ?? null }),
      ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
      ...(input.runtimeMode === undefined
        ? {}
        : {
            runtimeMode: input.runtimeMode,
            runtimeFailureCount: 0,
            runtimeRetryAt: null,
            runtimeIdleSince: null,
          }),
      ...(input.runtimeIdleTimeoutSeconds === undefined
        ? {}
        : { runtimeIdleTimeoutSeconds: input.runtimeIdleTimeoutSeconds }),
      ...(!('maxNormalSessions' in input)
        ? {}
        : { maxNormalSessions: input.maxNormalSessions ?? null }),
      ...(input.tabAudioEnabled === undefined ? {} : { tabAudioEnabled: input.tabAudioEnabled }),
      ...(input.qualityPolicy === undefined ? {} : { qualityPolicy: input.qualityPolicy }),
      ...(input.viewerFocusPolicy === undefined
        ? {}
        : { viewerFocusPolicy: input.viewerFocusPolicy }),
    }
    if (Object.keys(changes).length === 0) {
      throw new BrowShareError({
        code: 'BAD_REQUEST',
        message: 'At least one Profile field must be updated.',
        statusCode: 400,
      })
    }

    try {
      await this.connection.db.transaction(async (transaction) => {
        if (
          'visibility' in input ||
          'proxyId' in input ||
          'healthcheckUrl' in input ||
          'storageQuotaBytes' in input
        )
          await lockSessionPolicyConfiguration(transaction)
        const [profile] = await transaction
          .select({
            deleteRequestedAt: profiles.deleteRequestedAt,
            storageQuotaBytes: profiles.storageQuotaBytes,
            proxyId: profiles.proxyId,
            healthcheckUrl: profiles.healthcheckUrl,
          })
          .from(profiles)
          .where(and(eq(profiles.id, profileId), isNull(profiles.deletedAt)))
          .for('update')
          .limit(1)
        if (profile === undefined) throw profileNotFound()
        if (profile.deleteRequestedAt !== null) throw profileDeletionPending()
        if ('proxyId' in input) await assertActiveProxy(transaction, input.proxyId ?? null)
        await transaction
          .update(profiles)
          .set({
            ...changes,
            updatedAt: sql`now()`,
            ...(input.storageQuotaBytes !== undefined &&
            input.storageQuotaBytes !== profile.storageQuotaBytes
              ? { storagePolicyVersion: sql`${profiles.storagePolicyVersion} + 1` }
              : {}),
            ...(('proxyId' in changes && changes.proxyId !== profile.proxyId) ||
            ('healthcheckUrl' in changes && changes.healthcheckUrl !== profile.healthcheckUrl)
              ? { routeVersion: sql`${profiles.routeVersion} + 1` }
              : {}),
          })
          .where(eq(profiles.id, profileId))
        if ('visibility' in input)
          await revokeTabSessions(
            transaction,
            eq(tabSessions.profileId, profileId),
            'ACCESS_REVOKED',
            context,
          )
        await writeProfileAudit(transaction, context, {
          action: 'profile.update',
          targetId: profileId,
          changes,
        })
      })
    } catch (cause) {
      if (isPostgresUniqueViolation(cause)) throw profileNameConflict(cause)
      throw cause
    }
    return this.get(profileId)
  }

  async setState(
    profileId: string,
    state: SetProfileBusinessStateRequest['state'],
    context: ProfileAuditContext,
  ): Promise<ProfileResponse> {
    assertPublicId(profileId, 'Profile')
    await this.connection.db.transaction(async (transaction) => {
      await lockSessionPolicyConfiguration(transaction)
      const [profile] = await transaction
        .select({
          businessStatus: profiles.businessStatus,
          deleteRequestedAt: profiles.deleteRequestedAt,
        })
        .from(profiles)
        .where(and(eq(profiles.id, profileId), isNull(profiles.deletedAt)))
        .for('update')
        .limit(1)
      if (profile === undefined) throw profileNotFound()
      if (state === 'ENABLED' && profile.deleteRequestedAt !== null) {
        throw profileDeletionPending()
      }
      if (profile.businessStatus !== state) {
        await transaction
          .update(profiles)
          .set({ businessStatus: state, updatedAt: sql`now()` })
          .where(eq(profiles.id, profileId))
      }
      if (state === 'DISABLED')
        await revokeTabSessions(
          transaction,
          eq(tabSessions.profileId, profileId),
          'PROFILE_DISABLED',
          context,
        )
      await writeProfileAudit(transaction, context, {
        action: state === 'ENABLED' ? 'profile.enable' : 'profile.disable',
        targetId: profileId,
        changes: { state },
      })
    })
    return this.get(profileId)
  }

  async requestDeletion(
    profileId: string,
    expectedName: string,
    context: ProfileAuditContext,
  ): Promise<ProfileResponse> {
    assertPublicId(profileId, 'Profile')
    await this.connection.db.transaction(async (transaction) => {
      await lockSessionPolicyConfiguration(transaction)
      const [profile] = await transaction
        .select({
          name: profiles.name,
          businessStatus: profiles.businessStatus,
          deleteRequestedAt: profiles.deleteRequestedAt,
        })
        .from(profiles)
        .where(and(eq(profiles.id, profileId), isNull(profiles.deletedAt)))
        .for('update')
        .limit(1)
      if (profile === undefined) throw profileNotFound()
      if (expectedName !== profile.name) {
        throw new BrowShareError({
          code: 'CONFLICT',
          message: 'Profile name confirmation does not match.',
          statusCode: 409,
        })
      }
      if (profile.deleteRequestedAt === null) {
        await transaction
          .update(profiles)
          .set({
            businessStatus: 'DISABLED',
            deleteRequestedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(profiles.id, profileId))
        await revokeTabSessions(
          transaction,
          eq(tabSessions.profileId, profileId),
          'PROFILE_DELETED',
          context,
        )
        await writeProfileAudit(transaction, context, {
          action: 'profile.delete.request',
          targetId: profileId,
          changes: {
            previousBusinessStatus: profile.businessStatus,
            businessStatus: 'DISABLED',
            cleanupPending: true,
          },
        })
      }
    })
    return this.readProfile(profileId, true)
  }

  async getSummary(): Promise<ProfileListSummary> {
    return this.loadSummary([isNull(profiles.deletedAt)])
  }

  private buildFilters(query: ProfileListQuery): SQL[] {
    const filters: SQL[] = [isNull(profiles.deletedAt)]
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
      filters.push(or(ilike(profiles.name, search), ilike(profiles.description, search))!)
    }
    if (query.businessStatus !== undefined && query.businessStatus !== 'ALL') {
      filters.push(eq(profiles.businessStatus, query.businessStatus))
    }
    if (query.runtimeState !== undefined && query.runtimeState !== 'ALL') {
      filters.push(eq(profiles.runtimeState, query.runtimeState))
    }
    if (query.workerId !== undefined) filters.push(eq(profiles.workerId, query.workerId))
    if (query.groupId !== undefined) {
      filters.push(
        inArray(
          profiles.id,
          this.connection.db
            .select({ profileId: profileGroupMembers.profileId })
            .from(profileGroupMembers)
            .where(eq(profileGroupMembers.profileGroupId, query.groupId)),
        ),
      )
    }
    return filters
  }

  private async loadSummary(filters: readonly SQL[]): Promise<ProfileListSummary> {
    const activeSessionCounts = buildActiveSessionCounts(this.connection)
    const activeSessions = sql<number>`coalesce(${activeSessionCounts.activeSessions}, 0)`
    const [summary] = await this.connection.db
      .select({
        totalProfiles: sql<number>`count(*)::integer`,
        enabledProfiles: sql<number>`count(*) filter (where ${profiles.businessStatus} = 'ENABLED')::integer`,
        disabledProfiles: sql<number>`count(*) filter (where ${profiles.businessStatus} = 'DISABLED')::integer`,
        stopped: sql<number>`count(*) filter (where ${profiles.runtimeState} = 'STOPPED')::integer`,
        starting: sql<number>`count(*) filter (where ${profiles.runtimeState} = 'STARTING')::integer`,
        running: sql<number>`count(*) filter (where ${profiles.runtimeState} = 'RUNNING')::integer`,
        maintaining: sql<number>`count(*) filter (where ${profiles.runtimeState} = 'MAINTAINING')::integer`,
        stopping: sql<number>`count(*) filter (where ${profiles.runtimeState} = 'STOPPING')::integer`,
        error: sql<number>`count(*) filter (where ${profiles.runtimeState} = 'ERROR')::integer`,
        activeSessions: sql<number>`coalesce(sum(${activeSessions}), 0)::integer`,
        finiteSessionLimit: sql<number>`coalesce(sum(${profiles.maxNormalSessions}) filter (where ${profiles.maxNormalSessions} is not null), 0)::integer`,
        availableSessions: sql<number>`coalesce(sum(greatest(${profiles.maxNormalSessions} - ${activeSessions}, 0)) filter (where ${profiles.maxNormalSessions} is not null), 0)::integer`,
        unlimitedProfiles: sql<number>`count(*) filter (where ${profiles.maxNormalSessions} is null)::integer`,
        fullProfiles: sql<number>`count(*) filter (where ${profiles.maxNormalSessions} is not null and ${activeSessions} = ${profiles.maxNormalSessions})::integer`,
        overLimitProfiles: sql<number>`count(*) filter (where ${profiles.maxNormalSessions} is not null and ${activeSessions} > ${profiles.maxNormalSessions})::integer`,
      })
      .from(profiles)
      .leftJoin(activeSessionCounts, eq(activeSessionCounts.profileId, profiles.id))
      .where(and(...filters))

    if (summary === undefined) throw new Error('Profile summary query returned no row')
    return {
      totalProfiles: summary.totalProfiles,
      enabledProfiles: summary.enabledProfiles,
      disabledProfiles: summary.disabledProfiles,
      runtime: {
        stopped: summary.stopped,
        starting: summary.starting,
        running: summary.running,
        maintaining: summary.maintaining,
        stopping: summary.stopping,
        error: summary.error,
      },
      activeSessions: summary.activeSessions,
      finiteSessionLimit: summary.finiteSessionLimit,
      availableSessions: summary.availableSessions,
      unlimitedProfiles: summary.unlimitedProfiles,
      fullProfiles: summary.fullProfiles,
      overLimitProfiles: summary.overLimitProfiles,
    }
  }

  private async loadGroups(
    profileIds: readonly string[],
  ): Promise<Map<string, ProfileGroupSummary[]>> {
    if (profileIds.length === 0) return new Map()
    const rows = await this.connection.db
      .select({
        profileId: profileGroupMembers.profileId,
        id: profileGroups.id,
        name: profileGroups.name,
        status: profileGroups.status,
        priority: profileGroups.priority,
      })
      .from(profileGroupMembers)
      .innerJoin(profileGroups, eq(profileGroups.id, profileGroupMembers.profileGroupId))
      .where(
        and(inArray(profileGroupMembers.profileId, profileIds), isNull(profileGroups.deletedAt)),
      )
      .orderBy(asc(profileGroups.priority), asc(profileGroups.name), asc(profileGroups.id))

    const grouped = new Map<string, ProfileGroupSummary[]>()
    for (const row of rows) {
      const groups = grouped.get(row.profileId) ?? []
      groups.push({ id: row.id, name: row.name, status: row.status, priority: row.priority })
      grouped.set(row.profileId, groups)
    }
    return grouped
  }

  private async loadFacets(): Promise<ProfileListResponse['facets']> {
    const [workerRows, groupRows, proxyRows] = await Promise.all([
      this.connection.db
        .select({ id: workers.id, name: workers.name, state: workers.status })
        .from(workers)
        .where(isNull(workers.deletedAt))
        .orderBy(asc(workers.name), asc(workers.id)),
      this.connection.db
        .select({
          id: profileGroups.id,
          name: profileGroups.name,
          status: profileGroups.status,
          priority: profileGroups.priority,
        })
        .from(profileGroups)
        .where(isNull(profileGroups.deletedAt))
        .orderBy(asc(profileGroups.priority), asc(profileGroups.name), asc(profileGroups.id)),
      this.connection.db
        .select({
          id: proxies.id,
          name: proxies.name,
          type: proxies.type,
          healthStatus: proxies.healthStatus,
        })
        .from(proxies)
        .where(isNull(proxies.deletedAt))
        .orderBy(asc(proxies.name), asc(proxies.id)),
    ])
    return { workers: workerRows, groups: groupRows, proxies: proxyRows }
  }

  private toResponse(
    record: ProfileListRecord,
    groups: readonly ProfileGroupSummary[],
  ): ProfileResponse {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      worker: { id: record.workerId, name: record.workerName, state: record.workerState },
      proxy: toProxySummary(record),
      groups: [...groups],
      visibility: record.visibility,
      businessStatus: record.businessStatus,
      runtimeState: record.runtimeState,
      runtimeRecovery: profileRuntimeRecovery(
        record,
        {
          status: record.workerState,
          deletedAt: record.workerDeletedAt,
          runtimeSnapshot: record.workerRuntimeSnapshot,
        },
        this.control.getWorkerControlStatus(record.workerId),
      ),
      runtimeMode: record.runtimeMode,
      runtimeIdleTimeoutSeconds: record.runtimeIdleTimeoutSeconds,
      runtimeFailureCount: record.runtimeFailureCount,
      runtimeRetryAt: toNullableIsoTimestamp(record.runtimeRetryAt),
      runtimeGeneration: record.runtimeGeneration,
      ...profileStorageSummary(record),
      routeVersion: record.routeVersion,
      runtimeRouteVersion: record.runtimeRouteVersion,
      runtimeProxyHealth: record.runtimeProxyHealth,
      restartRequired:
        record.runtimeRouteVersion !== null && record.runtimeRouteVersion !== record.routeVersion,
      healthcheckUrl: record.healthcheckUrl,
      runtimeErrorCode: record.runtimeErrorCode,
      runtimeErrorSummary: record.runtimeErrorSummary,
      capacity: summarizeCapacity(record.maxNormalSessions, record.activeSessions),
      tabAudioEnabled: record.tabAudioEnabled,
      qualityPolicy: record.qualityPolicy,
      viewerFocusPolicy: record.viewerFocusPolicy,
      deleteRequestedAt: toNullableIsoTimestamp(record.deleteRequestedAt),
      createdAt: toIsoTimestamp(record.createdAt),
      updatedAt: toIsoTimestamp(record.updatedAt),
    }
  }
}

function buildActiveSessionCounts(connection: DatabaseConnection) {
  return connection.db
    .select({
      profileId: tabSessions.profileId,
      activeSessions: count().as('active_sessions'),
    })
    .from(tabSessions)
    .where(
      and(eq(tabSessions.kind, 'NORMAL'), notInArray(tabSessions.status, ['CLOSED', 'FAILED'])),
    )
    .groupBy(tabSessions.profileId)
    .as('profile_active_session_counts')
}

function toProxySummary(record: ProfileListRecord): ProfileProxySummary | null {
  if (record.proxyId === null) return null
  if (record.proxyName === null || record.proxyType === null || record.proxyHealthStatus === null) {
    throw new Error(`Profile ${record.id} references a missing active Proxy`)
  }
  return {
    id: record.proxyId,
    name: record.proxyName,
    type: record.proxyType,
    healthStatus: record.proxyHealthStatus,
  }
}

function summarizeCapacity(
  maxNormalSessions: number | null,
  activeSessions: number,
): ProfileCapacitySummary {
  if (maxNormalSessions === null) {
    return { maxNormalSessions, activeSessions, availableSessions: null, state: 'UNLIMITED' }
  }
  const availableSessions = Math.max(0, maxNormalSessions - activeSessions)
  const state =
    activeSessions > maxNormalSessions
      ? 'OVER_LIMIT'
      : activeSessions === maxNormalSessions
        ? 'FULL'
        : 'AVAILABLE'
  return { maxNormalSessions, activeSessions, availableSessions, state }
}

function assertOptionalPublicId(value: string | undefined, label: string): void {
  if (value !== undefined) assertPublicId(value, label)
}

function assertOptionalNullablePublicId(value: string | null | undefined, label: string): void {
  if (value !== undefined && value !== null) assertPublicId(value, label)
}

function assertPublicId(value: string, label: string): void {
  if (!isPublicId(value)) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: `${label} ID must be a UUIDv7.`,
      statusCode: 400,
    })
  }
}

type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]

async function assertActiveProxy(transaction: Transaction, proxyId: string | null): Promise<void> {
  if (proxyId === null) return
  const [proxy] = await transaction
    .select({ id: proxies.id })
    .from(proxies)
    .where(and(eq(proxies.id, proxyId), isNull(proxies.deletedAt)))
    .for('update')
    .limit(1)
  if (proxy !== undefined) return
  throw new BrowShareError({
    code: 'NOT_FOUND',
    message: 'The selected Proxy does not exist.',
    statusCode: 404,
  })
}

async function writeProfileAudit(
  transaction: Transaction,
  context: ProfileAuditContext,
  event: {
    readonly action: string
    readonly targetId: string
    readonly changes: Record<string, unknown>
  },
): Promise<void> {
  await transaction.insert(auditEvents).values({
    id: createPublicId(),
    actorUserId: context.actorUserId,
    action: event.action,
    targetType: 'profile',
    targetId: event.targetId,
    result: 'SUCCEEDED',
    requestId: context.requestId,
    changes: Object.fromEntries(
      Object.entries(event.changes).map(([key, value]) =>
        key === 'healthcheckUrl' ? ['hasHealthcheckUrl', value !== null] : [key, value],
      ),
    ),
    metadata: {},
  })
}

function normalizeProfileName(value: string): string {
  const name = value.trim()
  if (name.length === 0 || name.length > 128) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: 'Profile name must contain between 1 and 128 characters.',
      statusCode: 400,
    })
  }
  return name
}

function normalizeDescription(value: string | null): string | null {
  if (value === null) return null
  const description = value.trim()
  if (description.length > 4000) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: 'Profile description must not exceed 4000 characters.',
      statusCode: 400,
    })
  }
  return description.length === 0 ? null : description
}

function profileNameConflict(cause: unknown): BrowShareError {
  return new BrowShareError({
    code: 'CONFLICT',
    message: 'A Profile with this name already exists.',
    statusCode: 409,
    cause,
  })
}

function profileDeletionPending(): BrowShareError {
  return new BrowShareError({
    code: 'CONFLICT',
    message: 'The Profile already has a pending deletion request.',
    statusCode: 409,
  })
}

function profileNotFound(): BrowShareError {
  return new BrowShareError({
    code: 'NOT_FOUND',
    message: 'The Profile does not exist.',
    statusCode: 404,
  })
}

function toIsoTimestamp(value: string): string {
  return new Date(value).toISOString()
}

function toNullableIsoTimestamp(value: string | null): string | null {
  return value === null ? null : toIsoTimestamp(value)
}

function toAccessibleProfile(profile: ProfileResponse): AccessibleProfile {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    runtimeState: profile.runtimeState,
    runtimeMode: profile.runtimeMode,
    ...profileStorageSummary(profile),
    routeVersion: profile.routeVersion,
    runtimeRouteVersion: profile.runtimeRouteVersion,
    runtimeProxyHealth: profile.runtimeProxyHealth,
    restartRequired: profile.restartRequired,
    capacity: profile.capacity,
    groups: profile.groups.filter((group) => group.status === 'ENABLED'),
  }
}
