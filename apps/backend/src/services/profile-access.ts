import {
  profiles,
  users,
  userProfileGrants,
  userProfileGroups,
  profileGroupMembers,
  profileGroups,
} from '@browshare/database/schema'
import { and, eq, isNull, or, sql } from 'drizzle-orm'

/** The same predicate belongs in lists, single-resource reads, and future Session reservations. */
export function profileAccessCondition(userId: string) {
  return and(
    isNull(profiles.deletedAt),
    isNull(profiles.deleteRequestedAt),
    eq(profiles.businessStatus, 'ENABLED'),
    sql`exists (select 1 from ${users} where ${users.id}=${userId} and ${users.status}='ENABLED' and ${users.deletedAt} is null)`,
    or(
      eq(profiles.visibility, 'ALL_ENABLED_USERS'),
      sql`exists (select 1 from ${userProfileGrants} where ${userProfileGrants.profileId}=${profiles.id} and ${userProfileGrants.userId}=${userId})`,
      sql`exists (select 1 from ${profileGroupMembers} join ${profileGroups} on ${profileGroups.id}=${profileGroupMembers.profileGroupId} join ${userProfileGroups} on ${userProfileGroups.profileGroupId}=${profileGroups.id} where ${profileGroupMembers.profileId}=${profiles.id} and ${userProfileGroups.userId}=${userId} and ${profileGroups.status}='ENABLED' and ${profileGroups.deletedAt} is null)`,
    ),
  )!
}
