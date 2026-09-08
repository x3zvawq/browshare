import { BrowShareError } from '@browshare/common'
import {
  DEFAULT_SESSION_POLICY,
  type ResolvedSessionPolicy,
  type SessionPolicyValues,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { sessionPolicies, profileGroups, profileGroupMembers } from '@browshare/database/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

export type PolicyTransaction = Parameters<
  Parameters<DatabaseConnection['db']['transaction']>[0]
>[0]
type PolicyReader = DatabaseConnection['db'] | PolicyTransaction
export const policyValueKeys = Object.keys(DEFAULT_SESSION_POLICY) as (keyof SessionPolicyValues)[]
export function policyValues(row: SessionPolicyValues): SessionPolicyValues {
  return Object.fromEntries(policyValueKeys.map((key) => [key, row[key]])) as SessionPolicyValues
}

// Policy writes and group edits share one tenant-wide transaction lock: neither side may
// validate against an overlap/priority that the other side changes before commit.
export async function lockSessionPolicyConfiguration(tx: PolicyTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(28691, 1)`)
}

export async function assertSessionPolicyConflictsAbsent(tx: PolicyTransaction): Promise<void> {
  const result = await tx.execute(sql`
    select a.id from session_policies a
    join profile_groups ga on ga.id=a.profile_group_id and ga.status='ENABLED' and ga.deleted_at is null
    join profile_group_members ma on ma.profile_group_id=ga.id
    join profile_group_members mb on mb.profile_id=ma.profile_id and mb.profile_group_id<>ga.id
    join profile_groups gb on gb.id=mb.profile_group_id and gb.status='ENABLED' and gb.deleted_at is null and gb.priority=ga.priority
    join session_policies b on b.profile_group_id=gb.id and b.user_id=a.user_id and b.scope='USER_PROFILE_GROUP'
    join profiles p on p.id=ma.profile_id and p.deleted_at is null
    join users u on u.id=a.user_id and u.deleted_at is null
    where a.scope='USER_PROFILE_GROUP' and row(a.recycle_disabled,a.viewer_disconnect_timeout_seconds,a.no_input_timeout_seconds,a.no_frame_change_timeout_seconds,a.max_duration_seconds,a.proxy_failure_timeout_seconds,a.countdown_seconds)
      is distinct from row(b.recycle_disabled,b.viewer_disconnect_timeout_seconds,b.no_input_timeout_seconds,b.no_frame_change_timeout_seconds,b.max_duration_seconds,b.proxy_failure_timeout_seconds,b.countdown_seconds)
    limit 1`)
  if (result.length)
    throw new BrowShareError({
      code: 'SESSION_POLICY_CONFLICT',
      statusCode: 409,
      message:
        'Overlapping enabled groups have different Session policies for the same user at equal priority. Choose distinct priorities or identical policies.',
    })
}

/** Caller snapshots the entire result within the Session reservation transaction. */
export async function resolveSessionPolicy(
  db: PolicyReader,
  userId: string,
  profileId: string,
): Promise<ResolvedSessionPolicy> {
  const [direct] = await db
    .select()
    .from(sessionPolicies)
    .where(
      and(
        eq(sessionPolicies.scope, 'USER_PROFILE'),
        eq(sessionPolicies.userId, userId),
        eq(sessionPolicies.profileId, profileId),
      ),
    )
  if (direct)
    return {
      scope: direct.scope,
      policyId: direct.id,
      profileGroupId: null,
      priority: null,
      values: policyValues(direct),
    }
  const [group] = await db
    .select({ policy: sessionPolicies, priority: profileGroups.priority })
    .from(sessionPolicies)
    .innerJoin(profileGroups, eq(profileGroups.id, sessionPolicies.profileGroupId))
    .innerJoin(profileGroupMembers, eq(profileGroupMembers.profileGroupId, profileGroups.id))
    .where(
      and(
        eq(sessionPolicies.scope, 'USER_PROFILE_GROUP'),
        eq(sessionPolicies.userId, userId),
        eq(profileGroupMembers.profileId, profileId),
        eq(profileGroups.status, 'ENABLED'),
        isNull(profileGroups.deletedAt),
      ),
    )
    .orderBy(desc(profileGroups.priority), profileGroups.id)
    .limit(1)
  if (group)
    return {
      scope: group.policy.scope,
      policyId: group.policy.id,
      profileGroupId: group.policy.profileGroupId,
      priority: group.priority,
      values: policyValues(group.policy),
    }
  const [global] = await db
    .select()
    .from(sessionPolicies)
    .where(eq(sessionPolicies.scope, 'GLOBAL'))
  return {
    scope: 'GLOBAL',
    policyId: global?.id ?? null,
    profileGroupId: null,
    priority: null,
    values: global ? policyValues(global) : { ...DEFAULT_SESSION_POLICY },
  }
}
