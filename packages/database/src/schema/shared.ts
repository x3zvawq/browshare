import { sql } from 'drizzle-orm'
import { jsonb, timestamp, uuid } from 'drizzle-orm/pg-core'

export type JsonObject = Readonly<Record<string, unknown>>

export function publicId(name = 'id') {
  return uuid(name)
}

export function utcTimestamp(name: string) {
  return timestamp(name, { mode: 'string', precision: 3, withTimezone: true })
}

export function createdAt() {
  return utcTimestamp('created_at').notNull().defaultNow()
}

export function updatedAt() {
  return utcTimestamp('updated_at').notNull().defaultNow()
}

export function jsonObject(name: string) {
  return jsonb(name).$type<JsonObject>()
}

export function jsonObjectNotNull(name: string) {
  return jsonObject(name)
    .notNull()
    .default(sql`'{}'::jsonb`)
}

export function jsonArrayNotNull<T>(name: string) {
  return jsonb(name)
    .$type<readonly T[]>()
    .notNull()
    .default(sql`'[]'::jsonb`)
}
