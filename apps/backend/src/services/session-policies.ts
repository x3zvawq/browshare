import {
  BrowShareError,
  createPublicId,
  decodePageCursor,
  encodePageCursor,
  isPublicId,
  normalizePageLimit,
} from '@browshare/common'
import type {
  SaveSessionPolicyRequest,
  SessionPolicyListQuery,
  SessionPolicyPreviewQuery,
  SessionPolicyResponse,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  profileGroups,
  profiles,
  sessionPolicies,
  users,
} from '@browshare/database/schema'
import { and, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { profileAccessCondition } from './profile-access.js'
import type { ProfileAuditContext } from './profiles.js'
import {
  assertSessionPolicyConflictsAbsent,
  lockSessionPolicyConfiguration,
  policyValues,
  resolveSessionPolicy,
  type PolicyTransaction,
} from './session-policy-rules.js'

export class SessionPolicyService {
  constructor(private readonly connection: DatabaseConnection) {}

  private query() {
    return this.connection.db
      .select({
        policy: sessionPolicies,
        userName: sql<string | null>`${users.displayName} || ' <' || ${users.email} || '>'`,
        profileName: profiles.name,
        profileGroupName: profileGroups.name,
      })
      .from(sessionPolicies)
      .leftJoin(users, eq(users.id, sessionPolicies.userId))
      .leftJoin(profiles, eq(profiles.id, sessionPolicies.profileId))
      .leftJoin(profileGroups, eq(profileGroups.id, sessionPolicies.profileGroupId))
  }
  async list(query: SessionPolicyListQuery) {
    const filters: SQL[] = [
      isNull(users.deletedAt),
      isNull(profiles.deletedAt),
      isNull(profileGroups.deletedAt),
    ]
    if (query.scope) filters.push(eq(sessionPolicies.scope, query.scope))
    for (const key of ['userId', 'profileId', 'profileGroupId'] as const) {
      if (query[key]) {
        assertId(query[key])
        filters.push(eq(sessionPolicies[key], query[key]))
      }
    }
    if (query.cursor) {
      const c = decodePageCursor(query.cursor)
      filters.push(
        or(
          lt(sessionPolicies.createdAt, c.createdAt),
          and(eq(sessionPolicies.createdAt, c.createdAt), lt(sessionPolicies.id, c.id)),
        )!,
      )
    }
    const limit = normalizePageLimit(query.limit)
    const rows = await this.query()
      .where(and(...filters))
      .orderBy(desc(sessionPolicies.createdAt), desc(sessionPolicies.id))
      .limit(limit + 1)
    const items = rows.slice(0, limit).map(mapPolicy),
      last = items.at(-1),
      hasMore = rows.length > limit
    return {
      items,
      meta: {
        hasMore,
        nextCursor:
          hasMore && last ? encodePageCursor({ createdAt: last.createdAt, id: last.id }) : null,
      },
    }
  }
  async get(id: string): Promise<SessionPolicyResponse> {
    assertId(id)
    const [row] = await this.query().where(
      and(
        eq(sessionPolicies.id, id),
        isNull(users.deletedAt),
        isNull(profiles.deletedAt),
        isNull(profileGroups.deletedAt),
      ),
    )
    if (!row) throw missing()
    return mapPolicy(row)
  }
  async save(input: SaveSessionPolicyRequest, context: ProfileAuditContext) {
    validateScope(input)
    const id = await this.connection.db.transaction(async (tx) => {
      await lockSessionPolicyConfiguration(tx)
      if (input.userId) {
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
          .for('share')
        if (!user) throw missing()
      }
      if (input.profileId) {
        const [profile] = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(
            and(
              eq(profiles.id, input.profileId),
              isNull(profiles.deletedAt),
              isNull(profiles.deleteRequestedAt),
            ),
          )
          .for('share')
        if (!profile) throw missing()
      }
      if (input.profileGroupId) {
        const [group] = await tx
          .select({ id: profileGroups.id })
          .from(profileGroups)
          .where(and(eq(profileGroups.id, input.profileGroupId), isNull(profileGroups.deletedAt)))
          .for('share')
        if (!group) throw missing()
      }
      const filters = [eq(sessionPolicies.scope, input.scope)]
      if (input.userId) filters.push(eq(sessionPolicies.userId, input.userId))
      if (input.profileId) filters.push(eq(sessionPolicies.profileId, input.profileId))
      if (input.profileGroupId)
        filters.push(eq(sessionPolicies.profileGroupId, input.profileGroupId))
      const [previous] = await tx
        .select()
        .from(sessionPolicies)
        .where(and(...filters))
      const policyId = previous?.id ?? createPublicId()
      if (previous)
        await tx
          .update(sessionPolicies)
          .set({ ...input.values, updatedAt: sql`now()`, updatedByUserId: context.actorUserId })
          .where(eq(sessionPolicies.id, policyId))
      else
        await tx.insert(sessionPolicies).values({
          id: policyId,
          scope: input.scope,
          userId: input.userId,
          profileId: input.profileId,
          profileGroupId: input.profileGroupId,
          ...input.values,
          createdByUserId: context.actorUserId,
          updatedByUserId: context.actorUserId,
        })
      await assertSessionPolicyConflictsAbsent(tx)
      await audit(tx, context, 'session_policy.save', policyId, {
        scope: input.scope,
        userId: input.userId,
        profileId: input.profileId,
        profileGroupId: input.profileGroupId,
        before: previous ? policyValues(previous) : null,
        after: input.values,
      })
      return policyId
    })
    return this.get(id)
  }
  async delete(id: string, context: ProfileAuditContext) {
    assertId(id)
    await this.connection.db.transaction(async (tx) => {
      await lockSessionPolicyConfiguration(tx)
      const [row] = await tx.delete(sessionPolicies).where(eq(sessionPolicies.id, id)).returning()
      if (!row) throw missing()
      await audit(tx, context, 'session_policy.delete', id, {
        scope: row.scope,
        userId: row.userId,
        profileId: row.profileId,
        profileGroupId: row.profileGroupId,
        values: policyValues(row),
      })
    })
  }
  async preview(query: SessionPolicyPreviewQuery) {
    assertId(query.userId)
    assertId(query.profileId)
    return this.connection.db.transaction(async (tx) => {
      await lockSessionPolicyConfiguration(tx)
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, query.userId), isNull(users.deletedAt)))
      const [profile] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.id, query.profileId), isNull(profiles.deletedAt)))
      if (!user || !profile) throw missing()
      const [access] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.id, query.profileId), profileAccessCondition(query.userId)))
      return {
        ...query,
        accessible: Boolean(access),
        resolved: await resolveSessionPolicy(tx, query.userId, query.profileId),
      }
    })
  }
}
function mapPolicy(row: {
  policy: typeof sessionPolicies.$inferSelect
  userName: string | null
  profileName: string | null
  profileGroupName: string | null
}): SessionPolicyResponse {
  const p = row.policy
  return {
    id: p.id,
    scope: p.scope,
    userId: p.userId,
    profileId: p.profileId,
    profileGroupId: p.profileGroupId,
    values: policyValues(p),
    userName: row.userName,
    profileName: row.profileName,
    profileGroupName: row.profileGroupName,
    createdAt: new Date(p.createdAt).toISOString(),
    updatedAt: new Date(p.updatedAt).toISOString(),
  }
}
function assertId(id: string) {
  if (!isPublicId(id))
    throw new BrowShareError({
      code: 'INVALID_REQUEST',
      statusCode: 400,
      message: 'Expected a UUIDv7 identifier.',
    })
}
function validateScope(input: SaveSessionPolicyRequest) {
  for (const id of [input.userId, input.profileId, input.profileGroupId]) if (id) assertId(id)
  const valid =
    input.scope === 'GLOBAL'
      ? !input.userId && !input.profileId && !input.profileGroupId
      : input.scope === 'USER_PROFILE'
        ? Boolean(input.userId && input.profileId && !input.profileGroupId)
        : Boolean(input.userId && input.profileGroupId && !input.profileId)
  if (!valid)
    throw new BrowShareError({
      code: 'INVALID_REQUEST',
      statusCode: 400,
      message: 'The policy scope does not match its User, Profile and Group identifiers.',
    })
}
function missing() {
  return new BrowShareError({
    code: 'NOT_FOUND',
    statusCode: 404,
    message: 'The policy or its target does not exist.',
  })
}
async function audit(
  tx: PolicyTransaction,
  context: ProfileAuditContext,
  action: string,
  id: string,
  payload: Record<string, unknown>,
) {
  await tx.insert(auditEvents).values({
    id: createPublicId(),
    actorUserId: context.actorUserId,
    action,
    targetType: 'session_policy',
    targetId: id,
    requestId: context.requestId,
    result: 'SUCCEEDED',
    changes: payload,
    metadata: {},
  })
}
