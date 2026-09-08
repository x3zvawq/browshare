import type { ProfileStorageUsage } from '@browshare/contracts'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

import {
  enabledStatusEnum,
  profileRuntimeModeEnum,
  profileRuntimeStateEnum,
  profileVisibilityEnum,
} from './enums.js'
import { proxies, workers } from './infrastructure.js'
import { users } from './identity.js'
import { createdAt, jsonObjectNotNull, publicId, updatedAt, utcTimestamp } from './shared.js'

export interface RuntimeProxyHealth {
  status: 'HEALTHY' | 'UNHEALTHY'
  checkedAt: string
  lastSucceededAt: string | null
  latencyMilliseconds: number | null
  httpStatus: number | null
  errorCode: string | null
}

export interface ViewerFocusPolicy {
  readonly mode: 'NEVER' | 'WHEN_HIDDEN' | 'WHEN_UNFOCUSED'
  readonly gracePeriodMs: number
}

export interface QualityPolicy {
  readonly maxWidth: number
  readonly maxHeight: number
  readonly maxFps: number
  readonly maxBitrateKbps: number | null
}

export const profiles = pgTable(
  'profiles',
  {
    id: publicId().primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    workerId: publicId('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'restrict' }),
    proxyId: publicId('proxy_id').references(() => proxies.id, { onDelete: 'restrict' }),
    visibility: profileVisibilityEnum('visibility').notNull().default('RESTRICTED'),
    businessStatus: enabledStatusEnum('business_status').notNull().default('ENABLED'),
    runtimeState: profileRuntimeStateEnum('runtime_state').notNull().default('STOPPED'),
    dataInitialized: boolean('data_initialized').notNull().default(false),
    routeVersion: integer('route_version').notNull().default(1),
    runtimeRouteVersion: integer('runtime_route_version'),
    runtimeProxyHealth: jsonb('runtime_proxy_health').$type<RuntimeProxyHealth>(),
    runtimeMode: profileRuntimeModeEnum('runtime_mode').notNull().default('ON_DEMAND'),
    runtimeIdleTimeoutSeconds: integer('runtime_idle_timeout_seconds').notNull().default(300),
    runtimeIdleSince: utcTimestamp('runtime_idle_since'),
    runtimeHealthySince: utcTimestamp('runtime_healthy_since'),
    runtimeFailureCount: integer('runtime_failure_count').notNull().default(0),
    runtimeFailureGeneration: integer('runtime_failure_generation').notNull().default(0),
    runtimeRetryAt: utcTimestamp('runtime_retry_at'),
    runtimeGeneration: integer('runtime_generation').notNull().default(0),
    runtimeId: publicId('runtime_id'),
    runtimeWorkerInstanceId: publicId('runtime_worker_instance_id'),
    runtimeDesiredState: varchar('runtime_desired_state', { length: 16 })
      .notNull()
      .default('STOPPED'),
    runtimeObservedAt: utcTimestamp('runtime_observed_at'),
    healthcheckUrl: varchar('healthcheck_url', { length: 2048 }),
    runtimeErrorCode: varchar('runtime_error_code', { length: 128 }),
    runtimeErrorSummary: text('runtime_error_summary'),
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' }),
    storagePolicyVersion: integer('storage_policy_version').notNull().default(1),
    storageUsage: jsonb('storage_usage').$type<ProfileStorageUsage>(),
    maxNormalSessions: integer('max_normal_sessions').default(4),
    tabAudioEnabled: boolean('tab_audio_enabled').notNull().default(true),
    viewerFocusPolicy: jsonb('viewer_focus_policy').$type<ViewerFocusPolicy>(),
    qualityPolicy: jsonb('quality_policy')
      .$type<QualityPolicy>()
      .notNull()
      .default(sql`'{"maxWidth":1920,"maxHeight":1080,"maxFps":60,"maxBitrateKbps":null}'::jsonb`),
    deletedAt: utcTimestamp('deleted_at'),
    deleteRequestedAt: utcTimestamp('delete_requested_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('profiles_id_worker_id_unique').on(table.id, table.workerId),
    uniqueIndex('profiles_name_active_unique')
      .on(table.name)
      .where(sql`${table.deletedAt} is null`),
    index('profiles_worker_id_idx').on(table.workerId),
    check('profiles_runtime_idle_timeout_check', sql`${table.runtimeIdleTimeoutSeconds} >= 0`),
    check('profiles_runtime_failure_count_check', sql`${table.runtimeFailureCount} >= 0`),
    check('profiles_runtime_failure_generation_check', sql`${table.runtimeFailureGeneration} >= 0`),
    check(
      'profiles_storage_quota_check',
      sql`${table.storageQuotaBytes} is null or ${table.storageQuotaBytes} between 0 and 9007199254740991`,
    ),
    index('profiles_proxy_id_idx').on(table.proxyId),
    index('profiles_business_runtime_idx').on(table.businessStatus, table.runtimeState),
    check('profiles_runtime_generation_check', sql`${table.runtimeGeneration} >= 0`),
    check(
      'profiles_runtime_desired_state_check',
      sql`${table.runtimeDesiredState} in ('RUNNING', 'STOPPED')`,
    ),
    check(
      'profiles_max_normal_sessions_check',
      sql`${table.maxNormalSessions} is null or ${table.maxNormalSessions} >= 0`,
    ),
    check(
      'profiles_quality_policy_object_check',
      sql`jsonb_typeof(${table.qualityPolicy}) = 'object'`,
    ),
  ],
)

export const profileGroups = pgTable(
  'profile_groups',
  {
    id: publicId().primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    status: enabledStatusEnum('status').notNull().default('ENABLED'),
    priority: integer('priority').notNull().default(0),
    deletedAt: utcTimestamp('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('profile_groups_name_active_unique')
      .on(table.name)
      .where(sql`${table.deletedAt} is null`),
    index('profile_groups_status_priority_idx').on(table.status, table.priority),
  ],
)

export const userProfileGrants = pgTable(
  'user_profile_grants',
  {
    userId: publicId('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profileId: publicId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    grantedByUserId: publicId('granted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    grantedAt: utcTimestamp('granted_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.profileId],
      name: 'user_profile_grants_pk',
    }),
    index('user_profile_grants_profile_id_idx').on(table.profileId),
  ],
)

export const userProfileGroups = pgTable(
  'user_profile_groups',
  {
    userId: publicId('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profileGroupId: publicId('profile_group_id')
      .notNull()
      .references(() => profileGroups.id, { onDelete: 'cascade' }),
    grantedByUserId: publicId('granted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    grantedAt: utcTimestamp('granted_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.profileGroupId],
      name: 'user_profile_groups_pk',
    }),
    index('user_profile_groups_group_id_idx').on(table.profileGroupId),
  ],
)

export const profileGroupMembers = pgTable(
  'profile_group_members',
  {
    profileId: publicId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    profileGroupId: publicId('profile_group_id')
      .notNull()
      .references(() => profileGroups.id, { onDelete: 'cascade' }),
    addedByUserId: publicId('added_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    addedAt: utcTimestamp('added_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.profileId, table.profileGroupId],
      name: 'profile_group_members_pk',
    }),
    index('profile_group_members_group_id_idx').on(table.profileGroupId),
  ],
)

export const userProfileContexts = pgTable(
  'user_profile_contexts',
  {
    id: publicId().primaryKey(),
    userId: publicId('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profileId: publicId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    variables: jsonObjectNotNull('variables'),
    updatedByUserId: publicId('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('user_profile_contexts_user_profile_unique').on(table.userId, table.profileId),
    index('user_profile_contexts_profile_id_idx').on(table.profileId),
    check(
      'user_profile_contexts_variables_object_check',
      sql`jsonb_typeof(${table.variables}) = 'object'`,
    ),
  ],
)

/** Pending immutable delivery payload; removed after completion, never returned by Profile APIs. */
export const profileRuntimeOutbox = pgTable(
  'profile_runtime_outbox',
  {
    id: publicId().primaryKey(),
    profileId: publicId('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    workerId: publicId('worker_id')
      .notNull()
      .references(() => workers.id),
    command: jsonObjectNotNull('command'),
    expiresAt: utcTimestamp('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [unique('profile_runtime_outbox_profile_unique').on(table.profileId)],
)
