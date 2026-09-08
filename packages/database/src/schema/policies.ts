import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

import {
  navigationActionEnum,
  pageScriptScopeEnum,
  sessionPolicyScopeEnum,
  versionStateEnum,
} from './enums.js'
import { users } from './identity.js'
import { profileGroups, profiles } from './profiles.js'
import { createdAt, jsonArrayNotNull, publicId, updatedAt, utcTimestamp } from './shared.js'

export interface NavigationRule {
  readonly id: string
  readonly enabled: boolean
  readonly pattern: string
  readonly action:
    | 'ALLOW_REMOTE'
    | 'DENY'
    | 'REDIRECT_REMOTE'
    | 'PROMPT_REMOTE'
    | 'OPEN_LOCAL_PROMPT'
    | 'DEFER_TO_SCRIPT'
  readonly redirectUrl?: string
}

export const sessionPolicies = pgTable(
  'session_policies',
  {
    id: publicId().primaryKey(),
    scope: sessionPolicyScopeEnum('scope').notNull(),
    userId: publicId('user_id').references(() => users.id, { onDelete: 'cascade' }),
    profileId: publicId('profile_id').references(() => profiles.id, { onDelete: 'cascade' }),
    profileGroupId: publicId('profile_group_id').references(() => profileGroups.id, {
      onDelete: 'cascade',
    }),
    recycleDisabled: boolean('recycle_disabled').notNull().default(false),
    viewerDisconnectTimeoutSeconds: integer('viewer_disconnect_timeout_seconds').default(300),
    noInputTimeoutSeconds: integer('no_input_timeout_seconds'),
    noFrameChangeTimeoutSeconds: integer('no_frame_change_timeout_seconds'),
    maxDurationSeconds: integer('max_duration_seconds'),
    proxyFailureTimeoutSeconds: integer('proxy_failure_timeout_seconds'),
    countdownSeconds: integer('countdown_seconds').notNull().default(60),
    createdByUserId: publicId('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedByUserId: publicId('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('session_policies_global_unique')
      .on(table.scope)
      .where(sql`${table.scope} = 'GLOBAL'`),
    uniqueIndex('session_policies_user_profile_unique')
      .on(table.userId, table.profileId)
      .where(sql`${table.scope} = 'USER_PROFILE'`),
    uniqueIndex('session_policies_user_group_unique')
      .on(table.userId, table.profileGroupId)
      .where(sql`${table.scope} = 'USER_PROFILE_GROUP'`),
    index('session_policies_profile_id_idx').on(table.profileId),
    index('session_policies_profile_group_id_idx').on(table.profileGroupId),
    check(
      'session_policies_scope_columns_check',
      sql`(
        ${table.scope} = 'GLOBAL'
        and ${table.userId} is null
        and ${table.profileId} is null
        and ${table.profileGroupId} is null
      ) or (
        ${table.scope} = 'USER_PROFILE'
        and ${table.userId} is not null
        and ${table.profileId} is not null
        and ${table.profileGroupId} is null
      ) or (
        ${table.scope} = 'USER_PROFILE_GROUP'
        and ${table.userId} is not null
        and ${table.profileId} is null
        and ${table.profileGroupId} is not null
      )`,
    ),
    check(
      'session_policies_timeouts_check',
      sql`(
        (${table.viewerDisconnectTimeoutSeconds} is null or ${table.viewerDisconnectTimeoutSeconds} > 0)
        and (${table.noInputTimeoutSeconds} is null or ${table.noInputTimeoutSeconds} > 0)
        and (${table.noFrameChangeTimeoutSeconds} is null or ${table.noFrameChangeTimeoutSeconds} > 0)
        and (${table.maxDurationSeconds} is null or ${table.maxDurationSeconds} > 0)
        and (${table.proxyFailureTimeoutSeconds} is null or ${table.proxyFailureTimeoutSeconds} > 0)
        and ${table.countdownSeconds} >= 0
      )`,
    ),
  ],
)

export const pageScriptVersions = pgTable(
  'page_script_versions',
  {
    id: publicId().primaryKey(),
    profileId: publicId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    state: versionStateEnum('state').notNull().default('DRAFT'),
    appliesTo: pageScriptScopeEnum('applies_to').notNull().default('NORMAL'),
    sourceCode: text('source_code').notNull(),
    changeSummary: varchar('change_summary', { length: 512 }),
    createdByUserId: publicId('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    publishedAt: utcTimestamp('published_at'),
    disabledAt: utcTimestamp('disabled_at'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('page_script_versions_profile_id_id_unique').on(table.profileId, table.id),
    uniqueIndex('page_script_versions_profile_version_unique').on(table.profileId, table.version),
    index('page_script_versions_profile_state_idx').on(table.profileId, table.state),
    check('page_script_versions_version_check', sql`${table.version} >= 1`),
  ],
)

export const navigationPolicyVersions = pgTable(
  'navigation_policy_versions',
  {
    id: publicId().primaryKey(),
    profileId: publicId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    state: versionStateEnum('state').notNull().default('DRAFT'),
    rules: jsonArrayNotNull<NavigationRule>('rules'),
    policyScript: text('policy_script'),
    defaultAction: navigationActionEnum('default_action').notNull().default('DENY'),
    changeSummary: varchar('change_summary', { length: 512 }),
    createdByUserId: publicId('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    publishedAt: utcTimestamp('published_at'),
    disabledAt: utcTimestamp('disabled_at'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('navigation_policy_versions_profile_id_id_unique').on(table.profileId, table.id),
    uniqueIndex('navigation_policy_versions_profile_version_unique').on(
      table.profileId,
      table.version,
    ),
    index('navigation_policy_versions_profile_state_idx').on(table.profileId, table.state),
    check('navigation_policy_versions_version_check', sql`${table.version} >= 1`),
    check(
      'navigation_policy_versions_rules_array_check',
      sql`jsonb_typeof(${table.rules}) = 'array'`,
    ),
  ],
)

export const profilePublications = pgTable(
  'profile_publications',
  {
    profileId: publicId('profile_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    pageScriptVersionId: publicId('page_script_version_id'),
    navigationPolicyVersionId: publicId('navigation_policy_version_id'),
    updatedByUserId: publicId('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.profileId, table.pageScriptVersionId],
      foreignColumns: [pageScriptVersions.profileId, pageScriptVersions.id],
      name: 'profile_publications_page_script_version_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.profileId, table.navigationPolicyVersionId],
      foreignColumns: [navigationPolicyVersions.profileId, navigationPolicyVersions.id],
      name: 'profile_publications_navigation_policy_version_fk',
    }).onDelete('restrict'),
  ],
)
