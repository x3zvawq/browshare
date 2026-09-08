import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core'

import { auditResultEnum } from './enums.js'
import { users } from './identity.js'
import { createdAt, jsonObjectNotNull, publicId, updatedAt, utcTimestamp } from './shared.js'

export const auditEvents = pgTable(
  'audit_events',
  {
    id: publicId().primaryKey(),
    actorUserId: publicId('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: varchar('action', { length: 128 }).notNull(),
    targetType: varchar('target_type', { length: 96 }).notNull(),
    targetId: text('target_id'),
    result: auditResultEnum('result').notNull(),
    requestId: varchar('request_id', { length: 128 }),
    sourceIpHash: varchar('source_ip_hash', { length: 128 }),
    changes: jsonObjectNotNull('changes'),
    metadata: jsonObjectNotNull('metadata'),
    occurredAt: utcTimestamp('occurred_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_events_occurred_at_idx').on(table.occurredAt),
    index('audit_events_actor_occurred_at_idx').on(table.actorUserId, table.occurredAt),
    index('audit_events_target_occurred_at_idx').on(
      table.targetType,
      table.targetId,
      table.occurredAt,
    ),
    index('audit_events_action_occurred_at_idx').on(table.action, table.occurredAt),
    check('audit_events_action_format_check', sql`${table.action} ~ '^[a-z][a-z0-9_.:-]*$'`),
    check(
      'audit_events_target_type_format_check',
      sql`${table.targetType} ~ '^[a-z][a-z0-9_.:-]*$'`,
    ),
    check('audit_events_changes_object_check', sql`jsonb_typeof(${table.changes}) = 'object'`),
    check('audit_events_metadata_object_check', sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
)

export const systemSettings = pgTable(
  'system_settings',
  {
    key: varchar('key', { length: 128 }).primaryKey(),
    value: jsonb('value').notNull(),
    revision: integer('revision').notNull().default(1),
    updatedByUserId: publicId('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('system_settings_key_format_check', sql`${table.key} ~ '^[a-z][a-z0-9_.:-]*$'`),
    check('system_settings_revision_check', sql`${table.revision} >= 1`),
  ],
)
