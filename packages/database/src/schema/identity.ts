import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

import { enabledStatusEnum } from './enums.js'
import { createdAt, publicId, updatedAt, utcTimestamp } from './shared.js'

export const users = pgTable(
  'users',
  {
    id: publicId().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: varchar('display_name', { length: 128 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    status: enabledStatusEnum('status').notNull().default('ENABLED'),
    maxActiveSessions: integer('max_active_sessions'),
    emailVerifiedAt: utcTimestamp('email_verified_at'),
    deletedAt: utcTimestamp('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    index('users_status_idx').on(table.status),
    check('users_email_normalized_check', sql`${table.email} = lower(btrim(${table.email}))`),
    check(
      'users_max_active_sessions_check',
      sql`${table.maxActiveSessions} is null or ${table.maxActiveSessions} >= 0`,
    ),
  ],
)

export const roles = pgTable(
  'roles',
  {
    id: publicId().primaryKey(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    deletedAt: utcTimestamp('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('roles_code_unique').on(table.code),
    check('roles_code_format_check', sql`${table.code} ~ '^[a-z][a-z0-9_.:-]*$'`),
  ],
)

export const permissions = pgTable(
  'permissions',
  {
    id: publicId().primaryKey(),
    code: varchar('code', { length: 96 }).notNull(),
    description: text('description').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('permissions_code_unique').on(table.code),
    check('permissions_code_format_check', sql`${table.code} ~ '^[a-z][a-z0-9_.:-]*$'`),
  ],
)

export const userRoles = pgTable(
  'user_roles',
  {
    userId: publicId('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: publicId('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedByUserId: publicId('assigned_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    assignedAt: utcTimestamp('assigned_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId], name: 'user_roles_pk' }),
    index('user_roles_role_id_idx').on(table.roleId),
  ],
)

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: publicId('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: publicId('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
    grantedAt: utcTimestamp('granted_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.roleId, table.permissionId],
      name: 'role_permissions_pk',
    }),
    index('role_permissions_permission_id_idx').on(table.permissionId),
  ],
)

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: publicId().primaryKey(),
    userId: publicId('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenDigest: varchar('token_digest', { length: 128 }).notNull(),
    deviceName: varchar('device_name', { length: 128 }),
    userAgentSummary: varchar('user_agent_summary', { length: 512 }),
    ipHash: varchar('ip_hash', { length: 128 }),
    expiresAt: utcTimestamp('expires_at').notNull(),
    lastSeenAt: utcTimestamp('last_seen_at').notNull(),
    revokedAt: utcTimestamp('revoked_at'),
    revokeReason: varchar('revoke_reason', { length: 96 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('auth_sessions_token_digest_unique').on(table.tokenDigest),
    index('auth_sessions_user_id_idx').on(table.userId),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
    check('auth_sessions_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)
