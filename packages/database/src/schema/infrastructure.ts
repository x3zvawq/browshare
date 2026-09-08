import type { WorkerStorageFact } from '@browshare/contracts'
import { sql } from 'drizzle-orm'
import {
  bigint,
  jsonb,
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
  proxyHealthStatusEnum,
  proxyTypeEnum,
  workerCredentialRotationStatusEnum,
  workerCredentialStatusEnum,
  workerEnrollmentStatusEnum,
  workerStatusEnum,
} from './enums.js'
import { users } from './identity.js'
import { createdAt, jsonObjectNotNull, publicId, updatedAt, utcTimestamp } from './shared.js'

export const workers = pgTable(
  'workers',
  {
    id: publicId().primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    reportedHostname: varchar('reported_hostname', { length: 255 }),
    platform: varchar('platform', { length: 32 }),
    architecture: varchar('architecture', { length: 32 }),
    status: workerStatusEnum('status').notNull().default('PENDING'),
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' }),
    storagePolicyVersion: integer('storage_policy_version').notNull().default(1),
    storageSnapshot: jsonb('storage_snapshot').$type<WorkerStorageFact>(),
    maxActiveTabs: integer('max_active_tabs').default(4),
    lastSeenAt: utcTimestamp('last_seen_at'),
    capabilities: jsonObjectNotNull('capabilities'),
    versions: jsonObjectNotNull('versions'),
    metricsSnapshot: jsonObjectNotNull('metrics_snapshot'),
    runtimeSnapshot: jsonObjectNotNull('runtime_snapshot'),
    lastSnapshotAt: utcTimestamp('last_snapshot_at'),
    lastProbeErrorCode: varchar('last_probe_error_code', { length: 128 }),
    lastProbeErrorSummary: text('last_probe_error_summary'),
    disabledAt: utcTimestamp('disabled_at'),
    deletedAt: utcTimestamp('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('workers_name_active_unique')
      .on(table.name)
      .where(sql`${table.deletedAt} is null`),
    check(
      'workers_storage_quota_check',
      sql`${table.storageQuotaBytes} is null or ${table.storageQuotaBytes} between 0 and 9007199254740991`,
    ),
    index('workers_status_idx').on(table.status),
    check(
      'workers_max_active_tabs_check',
      sql`${table.maxActiveTabs} is null or ${table.maxActiveTabs} >= 0`,
    ),
  ],
)

export const workerEnrollments = pgTable(
  'worker_enrollments',
  {
    id: publicId().primaryKey(),
    tokenDigest: varchar('token_digest', { length: 128 }).notNull(),
    status: workerEnrollmentStatusEnum('status').notNull().default('ACTIVE'),
    displayName: varchar('display_name', { length: 128 }),
    createdByUserId: publicId('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: utcTimestamp('expires_at').notNull(),
    consumedAt: utcTimestamp('consumed_at'),
    consumedByWorkerId: publicId('consumed_by_worker_id').references(() => workers.id, {
      onDelete: 'set null',
    }),
    revokedAt: utcTimestamp('revoked_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('worker_enrollments_token_digest_unique').on(table.tokenDigest),
    index('worker_enrollments_status_expires_idx').on(table.status, table.expiresAt),
    check('worker_enrollments_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)

export const workerCredentials = pgTable(
  'worker_credentials',
  {
    id: publicId().primaryKey(),
    workerId: publicId('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    status: workerCredentialStatusEnum('status').notNull().default('ACTIVE'),
    certificateSerial: varchar('certificate_serial', { length: 128 }).notNull(),
    certificatePem: text('certificate_pem').notNull(),
    publicKeyPem: text('public_key_pem').notNull(),
    fingerprintSha256: varchar('fingerprint_sha256', { length: 95 }).notNull(),
    notBefore: utcTimestamp('not_before').notNull(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    revokedAt: utcTimestamp('revoked_at'),
    revokeReason: varchar('revoke_reason', { length: 128 }),
    createdAt: createdAt(),
  },
  (table) => [
    unique('worker_credentials_id_worker_id_unique').on(table.id, table.workerId),
    uniqueIndex('worker_credentials_certificate_serial_unique').on(table.certificateSerial),
    uniqueIndex('worker_credentials_fingerprint_unique').on(table.fingerprintSha256),
    index('worker_credentials_worker_status_idx').on(table.workerId, table.status),
    check('worker_credentials_validity_check', sql`${table.expiresAt} > ${table.notBefore}`),
  ],
)

export const workerCredentialRotations = pgTable(
  'worker_credential_rotations',
  {
    id: publicId().primaryKey(),
    workerId: publicId('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'restrict' }),
    replacesCredentialId: publicId('replaces_credential_id').notNull(),
    issuedCredentialId: publicId('issued_credential_id'),
    tokenDigest: varchar('token_digest', { length: 128 }).notNull(),
    status: workerCredentialRotationStatusEnum('status').notNull().default('ACTIVE'),
    createdByUserId: publicId('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: utcTimestamp('expires_at').notNull(),
    consumedAt: utcTimestamp('consumed_at'),
    revokedAt: utcTimestamp('revoked_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('worker_credential_rotations_token_digest_unique').on(table.tokenDigest),
    index('worker_credential_rotations_worker_status_idx').on(table.workerId, table.status),
    index('worker_credential_rotations_status_expires_idx').on(table.status, table.expiresAt),
    foreignKey({
      columns: [table.replacesCredentialId, table.workerId],
      foreignColumns: [workerCredentials.id, workerCredentials.workerId],
      name: 'worker_credential_rotations_replaces_worker_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.issuedCredentialId, table.workerId],
      foreignColumns: [workerCredentials.id, workerCredentials.workerId],
      name: 'worker_credential_rotations_issued_worker_fk',
    }).onDelete('restrict'),
    check('worker_credential_rotations_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)

export const proxies = pgTable(
  'proxies',
  {
    id: publicId().primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    type: proxyTypeEnum('type').notNull(),
    host: varchar('host', { length: 255 }),
    port: integer('port'),
    username: text('username'),
    password: text('password'),
    healthcheckUrl: text('healthcheck_url'),
    healthStatus: proxyHealthStatusEnum('health_status').notNull().default('UNKNOWN'),
    configurationVersion: integer('configuration_version').notNull().default(1),
    lastProbeWorkerId: publicId('last_probe_worker_id').references(() => workers.id, {
      onDelete: 'set null',
    }),
    lastProbeMode: varchar('last_probe_mode', { length: 16 }),
    lastExitIp: varchar('last_exit_ip', { length: 45 }),
    lastProbeId: publicId('last_probe_id'),
    lastCheckedAt: utcTimestamp('last_checked_at'),
    lastSucceededAt: utcTimestamp('last_succeeded_at'),
    lastErrorSummary: text('last_error_summary'),
    deletedAt: utcTimestamp('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('proxies_name_active_unique')
      .on(table.name)
      .where(sql`${table.deletedAt} is null`),
    index('proxies_health_status_idx').on(table.healthStatus),
    check(
      'proxies_endpoint_check',
      sql`(
        ${table.type} = 'DIRECT'
        and ${table.host} is null
        and ${table.port} is null
        and ${table.username} is null
        and ${table.password} is null
      ) or (
        ${table.type} <> 'DIRECT'
        and ${table.host} is not null
        and ${table.port} between 1 and 65535
      )`,
    ),
  ],
)
