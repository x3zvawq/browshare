import { sql } from 'drizzle-orm'
import {
  bigint,
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
  reservationStatusEnum,
  sessionStatusEnum,
  sessionKindEnum,
  viewerTicketPurposeEnum,
  viewerTicketStatusEnum,
} from './enums.js'
import { workers } from './infrastructure.js'
import { users } from './identity.js'
import { navigationPolicyVersions, pageScriptVersions } from './policies.js'
import { profiles } from './profiles.js'
import {
  createdAt,
  jsonObject,
  jsonObjectNotNull,
  publicId,
  updatedAt,
  utcTimestamp,
} from './shared.js'

export const tabSessions = pgTable(
  'tab_sessions',
  {
    id: publicId().primaryKey(),
    userId: publicId('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    profileId: publicId('profile_id').notNull(),
    workerId: publicId('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'restrict' }),
    kind: sessionKindEnum('kind').notNull().default('NORMAL'),
    maintenanceReleasedAt: utcTimestamp('maintenance_released_at'),
    status: sessionStatusEnum('status').notNull().default('RESERVED'),
    runtimeId: publicId('runtime_id'),
    profileGeneration: integer('profile_generation'),
    workerInstanceId: publicId('worker_instance_id'),
    runtimeObservedAt: utcTimestamp('runtime_observed_at'),
    displayName: varchar('display_name', { length: 256 }),
    hasCustomDisplayName: boolean('has_custom_display_name').notNull().default(false),
    remoteTitle: text('remote_title'),
    tabId: integer('tab_id'),
    targetId: varchar('target_id', { length: 256 }),
    gatewayId: publicId('gateway_id'),
    coreBindingTokenDigest: varchar('core_binding_token_digest', { length: 128 }),
    policySnapshot: jsonObjectNotNull('policy_snapshot'),
    recycling: jsonObject('recycling'),
    capabilities: jsonObjectNotNull('capabilities'),
    pageScriptVersionId: publicId('page_script_version_id'),
    navigationPolicyVersionId: publicId('navigation_policy_version_id'),
    viewerGeneration: integer('viewer_generation').notNull().default(0),
    activeViewerClientId: varchar('active_viewer_client_id', { length: 256 }),
    leaseExpiresAt: utcTimestamp('lease_expires_at'),
    lastInputAt: utcTimestamp('last_input_at'),
    lastFrameChangedAt: utcTimestamp('last_frame_changed_at'),
    viewerConnectedAt: utcTimestamp('viewer_connected_at'),
    viewerDisconnectedAt: utcTimestamp('viewer_disconnected_at'),
    closingAt: utcTimestamp('closing_at'),
    closedAt: utcTimestamp('closed_at'),
    closeReason: varchar('close_reason', { length: 128 }),
    failureCode: varchar('failure_code', { length: 128 }),
    failureSummary: text('failure_summary'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('tab_sessions_id_user_id_unique').on(table.id, table.userId),
    unique('tab_sessions_id_scope_unique').on(
      table.id,
      table.userId,
      table.profileId,
      table.workerId,
    ),
    uniqueIndex('tab_sessions_maintenance_owner_unique')
      .on(table.profileId)
      .where(sql`${table.kind} = 'MAINTENANCE' and ${table.maintenanceReleasedAt} is null`),
    index('tab_sessions_user_status_idx').on(table.userId, table.status),
    index('tab_sessions_profile_status_idx').on(table.profileId, table.status),
    index('tab_sessions_worker_status_idx').on(table.workerId, table.status),
    uniqueIndex('tab_sessions_active_worker_tab_unique')
      .on(table.workerId, table.tabId)
      .where(sql`${table.tabId} is not null and ${table.status} not in ('CLOSED', 'FAILED')`),
    uniqueIndex('tab_sessions_active_worker_target_unique')
      .on(table.workerId, table.targetId)
      .where(sql`${table.targetId} is not null and ${table.status} not in ('CLOSED', 'FAILED')`),
    foreignKey({
      columns: [table.profileId, table.workerId],
      foreignColumns: [profiles.id, profiles.workerId],
      name: 'tab_sessions_profile_worker_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.profileId, table.pageScriptVersionId],
      foreignColumns: [pageScriptVersions.profileId, pageScriptVersions.id],
      name: 'tab_sessions_page_script_version_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.profileId, table.navigationPolicyVersionId],
      foreignColumns: [navigationPolicyVersions.profileId, navigationPolicyVersions.id],
      name: 'tab_sessions_navigation_policy_version_fk',
    }).onDelete('restrict'),
    check('tab_sessions_viewer_generation_check', sql`${table.viewerGeneration} >= 0`),
    check(
      'tab_sessions_runtime_identity_check',
      sql`(${table.runtimeId} is null and ${table.profileGeneration} is null and ${table.workerInstanceId} is null and ${table.runtimeObservedAt} is null)
        or (${table.runtimeId} is not null and ${table.profileGeneration} is not null and ${table.profileGeneration} > 0 and ${table.workerInstanceId} is not null)`,
    ),
  ],
)

export const reservations = pgTable(
  'reservations',
  {
    id: publicId().primaryKey(),
    sessionId: publicId('session_id').notNull(),
    userId: publicId('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    profileId: publicId('profile_id').notNull(),
    workerId: publicId('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'restrict' }),
    messageId: publicId('message_id').notNull(),
    status: reservationStatusEnum('status').notNull().default('ACTIVE'),
    expiresAt: utcTimestamp('expires_at').notNull(),
    consumedAt: utcTimestamp('consumed_at'),
    releasedAt: utcTimestamp('released_at'),
    releaseReason: varchar('release_reason', { length: 128 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('reservations_session_id_unique').on(table.sessionId),
    uniqueIndex('reservations_message_id_unique').on(table.messageId),
    index('reservations_active_expiry_idx').on(table.status, table.expiresAt),
    foreignKey({
      columns: [table.sessionId, table.userId, table.profileId, table.workerId],
      foreignColumns: [
        tabSessions.id,
        tabSessions.userId,
        tabSessions.profileId,
        tabSessions.workerId,
      ],
      name: 'reservations_session_scope_fk',
    }).onDelete('cascade'),
    check('reservations_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)

export const viewerTickets = pgTable(
  'viewer_tickets',
  {
    id: publicId().primaryKey(),
    sessionId: publicId('session_id').notNull(),
    userId: publicId('user_id').notNull(),
    gatewayId: publicId('gateway_id').notNull(),
    tokenDigest: varchar('token_digest', { length: 128 }).notNull(),
    purpose: viewerTicketPurposeEnum('purpose').notNull().default('CONNECT'),
    status: viewerTicketStatusEnum('status').notNull().default('ACTIVE'),
    generation: integer('generation').notNull(),
    capabilities: jsonObjectNotNull('capabilities'),
    expiresAt: utcTimestamp('expires_at').notNull(),
    consumedAt: utcTimestamp('consumed_at'),
    revokedAt: utcTimestamp('revoked_at'),
    revokeReason: varchar('revoke_reason', { length: 128 }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('viewer_tickets_token_digest_unique').on(table.tokenDigest),
    index('viewer_tickets_session_status_idx').on(table.sessionId, table.status),
    index('viewer_tickets_expiry_idx').on(table.expiresAt),
    foreignKey({
      columns: [table.sessionId, table.userId],
      foreignColumns: [tabSessions.id, tabSessions.userId],
      name: 'viewer_tickets_session_user_fk',
    }).onDelete('cascade'),
    check('viewer_tickets_generation_check', sql`${table.generation} >= 0`),
    check('viewer_tickets_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)

/** Immutable Session close delivery. CLOSING remains authoritative if delivery expires. */
export const sessionCreateOutbox = pgTable(
  'session_create_outbox',
  {
    id: publicId().primaryKey(),
    sessionId: publicId('session_id')
      .notNull()
      .references(() => tabSessions.id, { onDelete: 'cascade' }),
    command: jsonObjectNotNull('command'),
    expiresAt: utcTimestamp('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [unique('session_create_outbox_session_unique').on(table.sessionId)],
)

export const sessionCloseOutbox = pgTable(
  'session_close_outbox',
  {
    id: publicId().primaryKey(),
    sessionId: publicId('session_id')
      .notNull()
      .references(() => tabSessions.id, { onDelete: 'cascade' }),
    command: jsonObjectNotNull('command'),
    expiresAt: utcTimestamp('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [unique('session_close_outbox_session_unique').on(table.sessionId)],
)

export const sessionEvents = pgTable(
  'session_events',
  {
    id: publicId().primaryKey(),
    sessionId: publicId('session_id')
      .notNull()
      .references(() => tabSessions.id, { onDelete: 'cascade' }),
    sequence: bigint('sequence', { mode: 'bigint' }).notNull(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    payload: jsonObjectNotNull('payload'),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('session_events_session_sequence_unique').on(table.sessionId, table.sequence),
    index('session_events_occurred_at_idx').on(table.occurredAt),
    check('session_events_sequence_check', sql`${table.sequence} >= 0`),
  ],
)
