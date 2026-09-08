import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { authSessions } from './identity.js'
import { tabSessions } from './sessions.js'
import { createdAt, publicId, updatedAt, utcTimestamp } from './shared.js'

/** Control-plane metadata only; file bytes and paths belong to the Worker. */
export const sessionDownloads = pgTable(
  'session_downloads',
  {
    id: publicId().primaryKey(),
    sessionId: publicId('session_id').notNull(),
    userId: publicId('user_id').notNull(),
    profileId: publicId('profile_id').notNull(),
    workerId: publicId('worker_id').notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    status: varchar('status', { length: 16 })
      .$type<'AVAILABLE' | 'CLAIMED' | 'EXPIRED'>()
      .notNull(),
    completedAt: utcTimestamp('completed_at').notNull(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    sessionEndedAt: utcTimestamp('session_ended_at'),
    claimedAt: utcTimestamp('claimed_at'),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.sessionId, table.userId, table.profileId, table.workerId],
      foreignColumns: [
        tabSessions.id,
        tabSessions.userId,
        tabSessions.profileId,
        tabSessions.workerId,
      ],
      name: 'session_downloads_session_scope_fk',
    }).onDelete('restrict'),
    index('session_downloads_user_session_idx').on(
      table.userId,
      table.sessionId,
      table.completedAt,
    ),
    index('session_downloads_worker_status_idx').on(table.workerId, table.status),
    check(
      'session_downloads_size_check',
      sql`${table.size} >= 0 and ${table.size} <= 9007199254740991`,
    ),
    check(
      'session_downloads_status_check',
      sql`${table.status} in ('AVAILABLE', 'CLAIMED', 'EXPIRED')`,
    ),
    check(
      'session_downloads_claimed_check',
      sql`(${table.status} = 'CLAIMED') = (${table.claimedAt} is not null)`,
    ),
  ],
)

export const downloadClaims = pgTable(
  'download_claims',
  {
    id: publicId().primaryKey(),
    downloadId: publicId('download_id')
      .notNull()
      .references(() => sessionDownloads.id, { onDelete: 'cascade' }),
    authSessionId: publicId('auth_session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    tokenDigest: varchar('token_digest', { length: 64 }).notNull(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    consumedAt: utcTimestamp('consumed_at'),
    workerInstanceId: publicId('worker_instance_id'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('download_claims_token_digest_unique').on(table.tokenDigest),
    index('download_claims_download_idx').on(table.downloadId),
    check(
      'download_claims_consumed_check',
      sql`(${table.consumedAt} is null) = (${table.workerInstanceId} is null)`,
    ),
    check('download_claims_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
)
