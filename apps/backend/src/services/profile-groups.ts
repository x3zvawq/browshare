import { revokeTabSessions } from './session-revocation.js'
import {
  lockSessionPolicyConfiguration,
  assertSessionPolicyConflictsAbsent,
} from './session-policy-rules.js'
import { escapeLike } from './search.js'
import {
  BrowShareError,
  createPublicId,
  decodePageCursor,
  encodePageCursor,
  isPublicId,
  normalizePageLimit,
} from '@browshare/common'
import type {
  CreateProfileGroupRequest,
  UpdateProfileGroupRequest,
  ProfileGroupListQuery,
  ProfileGroupListResponse,
  ProfileGroupResponse,
  ProfileGroupMembersResponse,
  SetProfileGroupMembersRequest,
  ProfileGrantsResponse,
  ProfileSubjectQuery,
  ProfileSubjectListResponse,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  tabSessions,
  profileGroups,
  profileGroupMembers,
  profiles,
  users,
  userProfileGroups,
  userProfileGrants,
  sessionPolicies,
} from '@browshare/database/schema'
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { isPostgresUniqueViolation } from './database-errors.js'
import type { ProfileAuditContext } from './profiles.js'

type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]
export interface ProfileGroupPort {
  list(query: ProfileGroupListQuery): Promise<ProfileGroupListResponse>
  get(id: string): Promise<ProfileGroupResponse>
  create(
    input: CreateProfileGroupRequest,
    context: ProfileAuditContext,
  ): Promise<ProfileGroupResponse>
  update(
    id: string,
    input: UpdateProfileGroupRequest,
    context: ProfileAuditContext,
  ): Promise<ProfileGroupResponse>
  setState(
    id: string,
    state: 'ENABLED' | 'DISABLED',
    context: ProfileAuditContext,
  ): Promise<ProfileGroupResponse>
  delete(id: string, context: ProfileAuditContext): Promise<void>
  getMembers(id: string): Promise<ProfileGroupMembersResponse>
  setMembers(
    id: string,
    input: SetProfileGroupMembersRequest,
    context: ProfileAuditContext,
  ): Promise<ProfileGroupMembersResponse>
  getGrants(id: string): Promise<ProfileGrantsResponse>
  setGrants(
    id: string,
    userIds: string[],
    context: ProfileAuditContext,
  ): Promise<ProfileGrantsResponse>
  subjects(query: ProfileSubjectQuery): Promise<ProfileSubjectListResponse>
}

// SELECT expressions strip column qualification; keep the outer group reference explicit
// so the correlated count cannot bind to the joined Profile or User id.
const groupFields = {
  id: profileGroups.id,
  name: profileGroups.name,
  description: profileGroups.description,
  status: profileGroups.status,
  priority: profileGroups.priority,
  createdAt: profileGroups.createdAt,
  updatedAt: profileGroups.updatedAt,
  profileCount: sql<number>`(select count(*)::integer from ${profileGroupMembers} join ${profiles} on ${profiles.id}=${profileGroupMembers.profileId} where ${profileGroupMembers.profileGroupId}=${profileGroups}.${sql.identifier(profileGroups.id.name)} and ${profiles.deletedAt} is null)`,
  userCount: sql<number>`(select count(*)::integer from ${userProfileGroups} join ${users} on ${users.id}=${userProfileGroups.userId} where ${userProfileGroups.profileGroupId}=${profileGroups}.${sql.identifier(profileGroups.id.name)} and ${users.deletedAt} is null)`,
}
const userSubjectFields = {
  id: users.id,
  name: sql<string>`${users.displayName} || ' <' || ${users.email} || '>'`,
  status: users.status,
}
const profileSubjectFields = {
  id: profiles.id,
  name: profiles.name,
  status: profiles.businessStatus,
}

export class ProfileGroupService implements ProfileGroupPort {
  constructor(private readonly connection: DatabaseConnection) {}

  async list(query: ProfileGroupListQuery): Promise<ProfileGroupListResponse> {
    const filters: SQL[] = [isNull(profileGroups.deletedAt)]
    const search = query.search?.trim()
    if (search)
      filters.push(
        or(
          ilike(profileGroups.name, `%${escapeLike(search)}%`),
          ilike(profileGroups.description, `%${escapeLike(search)}%`),
        )!,
      )
    if (query.status && query.status !== 'ALL') filters.push(eq(profileGroups.status, query.status))
    const cursor = pageCondition(query.cursor, profileGroups.createdAt, profileGroups.id)
    if (cursor) filters.push(cursor)
    const limit = normalizePageLimit(query.limit)
    const rows = await this.connection.db
      .select(groupFields)
      .from(profileGroups)
      .where(and(...filters))
      .orderBy(desc(profileGroups.createdAt), desc(profileGroups.id))
      .limit(limit + 1)
    return page(rows.map(groupResponse), limit)
  }

  async get(id: string): Promise<ProfileGroupResponse> {
    assertId(id)
    const [row] = await this.connection.db
      .select(groupFields)
      .from(profileGroups)
      .where(and(eq(profileGroups.id, id), isNull(profileGroups.deletedAt)))
    if (!row) throw missing('Profile Group')
    return groupResponse(row)
  }

  async create(
    input: CreateProfileGroupRequest,
    context: ProfileAuditContext,
  ): Promise<ProfileGroupResponse> {
    const id = createPublicId()
    const values = normalize(input)
    try {
      await this.connection.db.transaction(async (tx) => {
        await tx.insert(profileGroups).values({
          id,
          name: values.name!,
          description: values.description ?? null,
          priority: values.priority!,
        })
        await audit(tx, context, 'profile_group.create', id, values)
        await notify(tx)
      })
    } catch (cause) {
      if (isPostgresUniqueViolation(cause))
        throw conflict('A Profile Group with that name already exists.')
      throw cause
    }
    return this.get(id)
  }

  async update(
    id: string,
    input: UpdateProfileGroupRequest,
    context: ProfileAuditContext,
  ): Promise<ProfileGroupResponse> {
    assertId(id)
    const values = normalize(input)
    try {
      await this.connection.db.transaction(async (tx) => {
        await lockSessionPolicyConfiguration(tx)
        await lockGroup(tx, id)
        await tx
          .update(profileGroups)
          .set({ ...values, updatedAt: sql`now()` })
          .where(eq(profileGroups.id, id))
        await assertSessionPolicyConflictsAbsent(tx)
        await audit(tx, context, 'profile_group.update', id, values)
        await notify(tx)
      })
    } catch (cause) {
      if (isPostgresUniqueViolation(cause))
        throw conflict('A Profile Group with that name already exists.')
      throw cause
    }
    return this.get(id)
  }

  async setState(
    id: string,
    state: 'ENABLED' | 'DISABLED',
    context: ProfileAuditContext,
  ): Promise<ProfileGroupResponse> {
    assertId(id)
    await this.connection.db.transaction(async (tx) => {
      await lockSessionPolicyConfiguration(tx)
      const group = await lockGroup(tx, id)
      if (group.status === state) return
      await tx
        .update(profileGroups)
        .set({ status: state, updatedAt: sql`now()` })
        .where(eq(profileGroups.id, id))
      await assertSessionPolicyConflictsAbsent(tx)
      if (state === 'DISABLED')
        await revokeTabSessions(
          tx,
          sql`${tabSessions.profileId} in (select ${profileGroupMembers.profileId} from ${profileGroupMembers} where ${profileGroupMembers.profileGroupId}=${id})`,
          'ACCESS_REVOKED',
          context,
        )
      await audit(tx, context, 'profile_group.state', id, { state })
      await notify(tx)
    })
    return this.get(id)
  }

  async delete(id: string, context: ProfileAuditContext): Promise<void> {
    assertId(id)
    await this.connection.db.transaction(async (tx) => {
      await lockSessionPolicyConfiguration(tx)
      await lockGroup(tx, id)
      const affected = await tx
        .select({ id: profileGroupMembers.profileId })
        .from(profileGroupMembers)
        .where(eq(profileGroupMembers.profileGroupId, id))
      await tx.delete(profileGroupMembers).where(eq(profileGroupMembers.profileGroupId, id))
      await tx.delete(userProfileGroups).where(eq(userProfileGroups.profileGroupId, id))
      await tx.delete(sessionPolicies).where(eq(sessionPolicies.profileGroupId, id))
      await tx
        .update(profileGroups)
        .set({ status: 'DISABLED', deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(profileGroups.id, id))
      if (affected.length)
        await revokeTabSessions(
          tx,
          inArray(
            tabSessions.profileId,
            affected.map((p) => p.id),
          ),
          'ACCESS_REVOKED',
          context,
        )
      await audit(tx, context, 'profile_group.delete', id, {})
      await notify(tx)
    })
  }

  async getMembers(id: string): Promise<ProfileGroupMembersResponse> {
    await this.get(id)
    const [profileRows, userRows] = await Promise.all([
      this.connection.db
        .select(profileSubjectFields)
        .from(profileGroupMembers)
        .innerJoin(profiles, eq(profiles.id, profileGroupMembers.profileId))
        .where(and(eq(profileGroupMembers.profileGroupId, id), isNull(profiles.deletedAt)))
        .orderBy(asc(profiles.name), asc(profiles.id)),
      this.connection.db
        .select(userSubjectFields)
        .from(userProfileGroups)
        .innerJoin(users, eq(users.id, userProfileGroups.userId))
        .where(and(eq(userProfileGroups.profileGroupId, id), isNull(users.deletedAt)))
        .orderBy(asc(users.displayName), asc(users.id)),
    ])
    return { profiles: profileRows, users: userRows }
  }

  async setMembers(
    id: string,
    input: SetProfileGroupMembersRequest,
    context: ProfileAuditContext,
  ): Promise<ProfileGroupMembersResponse> {
    assertId(id)
    assertIds(input.profileIds)
    assertIds(input.userIds)
    await this.connection.db.transaction(async (tx) => {
      await lockSessionPolicyConfiguration(tx)
      await lockGroup(tx, id)
      if (input.profileIds.length) {
        const found = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(
            and(
              inArray(profiles.id, input.profileIds),
              isNull(profiles.deletedAt),
              isNull(profiles.deleteRequestedAt),
            ),
          )
          .orderBy(asc(profiles.id))
          .for('share')
        if (found.length !== input.profileIds.length)
          throw conflict('A selected Profile is missing or pending deletion.')
      }
      await lockUsers(tx, input.userIds)
      const previousProfiles = await tx
        .select({ id: profileGroupMembers.profileId })
        .from(profileGroupMembers)
        .where(eq(profileGroupMembers.profileGroupId, id))
      const previousUsers = await tx
        .select({ id: userProfileGroups.userId })
        .from(userProfileGroups)
        .where(eq(userProfileGroups.profileGroupId, id))
      const p = changes(previousProfiles, input.profileIds),
        u = changes(previousUsers, input.userIds)
      if (p.remove.length)
        await tx
          .delete(profileGroupMembers)
          .where(
            and(
              eq(profileGroupMembers.profileGroupId, id),
              inArray(profileGroupMembers.profileId, p.remove),
            ),
          )
      if (u.remove.length)
        await tx
          .delete(userProfileGroups)
          .where(
            and(
              eq(userProfileGroups.profileGroupId, id),
              inArray(userProfileGroups.userId, u.remove),
            ),
          )
      if (p.add.length)
        await tx.insert(profileGroupMembers).values(
          p.add.map((profileId) => ({
            profileGroupId: id,
            profileId,
            addedByUserId: context.actorUserId,
          })),
        )
      if (u.add.length)
        await tx.insert(userProfileGroups).values(
          u.add.map((userId) => ({
            profileGroupId: id,
            userId,
            grantedByUserId: context.actorUserId,
          })),
        )
      if (!(p.add.length || p.remove.length || u.add.length || u.remove.length)) return
      await tx
        .update(profileGroups)
        .set({ updatedAt: sql`now()` })
        .where(eq(profileGroups.id, id))
      await assertSessionPolicyConflictsAbsent(tx)
      if (previousProfiles.length)
        await revokeTabSessions(
          tx,
          inArray(
            tabSessions.profileId,
            previousProfiles.map((p) => p.id),
          ),
          'ACCESS_REVOKED',
          context,
        )
      await audit(tx, context, 'profile_group.members', id, { profiles: p, users: u })
      await notify(tx)
    })
    return this.getMembers(id)
  }

  async getGrants(id: string): Promise<ProfileGrantsResponse> {
    assertId(id)
    const [profile] = await this.connection.db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
    if (!profile) throw missing('Profile')
    const rows = await this.connection.db
      .select(userSubjectFields)
      .from(userProfileGrants)
      .innerJoin(users, eq(users.id, userProfileGrants.userId))
      .where(and(eq(userProfileGrants.profileId, id), isNull(users.deletedAt)))
      .orderBy(asc(users.displayName), asc(users.id))
    return { users: rows }
  }

  async setGrants(
    id: string,
    userIds: string[],
    context: ProfileAuditContext,
  ): Promise<ProfileGrantsResponse> {
    assertId(id)
    assertIds(userIds)
    await this.connection.db.transaction(async (tx) => {
      await lockSessionPolicyConfiguration(tx)
      const [profile] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(
          and(eq(profiles.id, id), isNull(profiles.deletedAt), isNull(profiles.deleteRequestedAt)),
        )
        .for('update')
      if (!profile) throw missing('Profile')
      await lockUsers(tx, userIds)
      const previous = await tx
        .select({ id: userProfileGrants.userId })
        .from(userProfileGrants)
        .where(eq(userProfileGrants.profileId, id))
      const delta = changes(previous, userIds)
      if (delta.remove.length)
        await tx
          .delete(userProfileGrants)
          .where(
            and(
              eq(userProfileGrants.profileId, id),
              inArray(userProfileGrants.userId, delta.remove),
            ),
          )
      if (delta.add.length)
        await tx.insert(userProfileGrants).values(
          delta.add.map((userId) => ({
            profileId: id,
            userId,
            grantedByUserId: context.actorUserId,
          })),
        )
      if (!(delta.add.length || delta.remove.length)) return
      await revokeTabSessions(tx, eq(tabSessions.profileId, id), 'ACCESS_REVOKED', context)
      await audit(tx, context, 'profile.grants', id, delta, 'profile')
      await notify(tx)
    })
    return this.getGrants(id)
  }

  async subjects(query: ProfileSubjectQuery): Promise<ProfileSubjectListResponse> {
    const limit = normalizePageLimit(query.limit)
    const search = query.search?.trim()
    if (query.kind === 'USER') {
      const filters = [isNull(users.deletedAt)]
      if (search)
        filters.push(
          or(
            ilike(users.displayName, `%${escapeLike(search)}%`),
            ilike(users.email, `%${escapeLike(search)}%`),
          )!,
        )
      if (query.status && query.status !== 'ALL') filters.push(eq(users.status, query.status))
      const cursor = pageCondition(query.cursor, users.createdAt, users.id)
      if (cursor) filters.push(cursor)
      const result = page(
        await this.connection.db
          .select({ ...userSubjectFields, createdAt: users.createdAt })
          .from(users)
          .where(and(...filters))
          .orderBy(desc(users.createdAt), desc(users.id))
          .limit(limit + 1),
        limit,
      )
      return {
        items: result.items.map(({ id, name, status }) => ({ id, name, status })),
        meta: result.meta,
      }
    }
    const filters = [isNull(profiles.deletedAt), isNull(profiles.deleteRequestedAt)]
    if (search) filters.push(ilike(profiles.name, `%${escapeLike(search)}%`))
    if (query.status && query.status !== 'ALL')
      filters.push(eq(profiles.businessStatus, query.status))
    const cursor = pageCondition(query.cursor, profiles.createdAt, profiles.id)
    if (cursor) filters.push(cursor)
    const result = page(
      await this.connection.db
        .select({ ...profileSubjectFields, createdAt: profiles.createdAt })
        .from(profiles)
        .where(and(...filters))
        .orderBy(desc(profiles.createdAt), desc(profiles.id))
        .limit(limit + 1),
      limit,
    )
    return {
      items: result.items.map(({ id, name, status }) => ({ id, name, status })),
      meta: result.meta,
    }
  }
}

function page<T extends { id: string; createdAt: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit),
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
function pageCondition(
  cursor: string | undefined,
  createdAt: typeof profileGroups.createdAt | typeof users.createdAt | typeof profiles.createdAt,
  id: typeof profileGroups.id | typeof users.id | typeof profiles.id,
) {
  if (!cursor) return undefined
  const value = decodePageCursor(cursor)
  return or(lt(createdAt, value.createdAt), and(eq(createdAt, value.createdAt), lt(id, value.id)))
}
function normalize(input: UpdateProfileGroupRequest) {
  const result: UpdateProfileGroupRequest = { ...input }
  if (input.name !== undefined) {
    result.name = input.name.trim()
    if (!result.name)
      throw new BrowShareError({
        code: 'BAD_REQUEST',
        message: 'Profile Group name must not be blank.',
        statusCode: 400,
      })
  }
  if (input.description !== undefined) result.description = input.description?.trim() || null
  return result
}
function assertId(id: string) {
  if (!isPublicId(id))
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: 'ID must be a UUIDv7.',
      statusCode: 400,
    })
}
function assertIds(ids: string[]) {
  ids.forEach(assertId)
  if (new Set(ids).size !== ids.length) throw conflict('Duplicate association IDs are not allowed.')
}
function missing(label: string) {
  return new BrowShareError({
    code: 'NOT_FOUND',
    message: `${label} does not exist.`,
    statusCode: 404,
  })
}
function conflict(message: string) {
  return new BrowShareError({ code: 'CONFLICT', message, statusCode: 409 })
}
function changes(previous: { id: string }[], next: string[]) {
  const old = new Set(previous.map((r) => r.id)),
    wanted = new Set(next)
  return {
    add: next.filter((id) => !old.has(id)),
    remove: [...old].filter((id) => !wanted.has(id)),
  }
}
async function lockGroup(tx: Transaction, id: string) {
  const [row] = await tx
    .select()
    .from(profileGroups)
    .where(and(eq(profileGroups.id, id), isNull(profileGroups.deletedAt)))
    .for('update')
  if (!row) throw missing('Profile Group')
  return row
}
async function lockUsers(tx: Transaction, ids: string[]) {
  if (!ids.length) return
  const found = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), isNull(users.deletedAt)))
    .orderBy(asc(users.id))
    .for('share')
  if (found.length !== ids.length) throw conflict('A selected user no longer exists.')
}
async function audit(
  tx: Transaction,
  context: ProfileAuditContext,
  action: string,
  id: string,
  changes: Record<string, unknown>,
  targetType = 'profile_group',
) {
  await tx.insert(auditEvents).values({
    id: createPublicId(),
    actorUserId: context.actorUserId,
    action,
    targetType,
    targetId: id,
    result: 'SUCCEEDED',
    requestId: context.requestId,
    changes,
    metadata: {},
  })
}
async function notify(tx: Transaction) {
  await tx.execute(sql`select pg_notify('browshare_profiles_changed', '')`)
}

function groupResponse(row: ProfileGroupResponse): ProfileGroupResponse {
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}
