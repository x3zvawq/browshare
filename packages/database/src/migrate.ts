import { fileURLToPath } from 'node:url'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

import type { DatabaseConnection } from './client.js'

export const MIGRATIONS_SCHEMA = 'browshare_internal'
export const MIGRATIONS_TABLE = 'schema_migrations'

export interface MigrationStatus {
  readonly current: boolean
  readonly expectedCount: number
  readonly appliedCount: number
  readonly expectedLatestAt: number | null
  readonly appliedLatestAt: number | null
  readonly reason: 'current' | 'missing' | 'behind' | 'ahead' | 'diverged'
}

export function defaultMigrationsFolder(): string {
  return fileURLToPath(new URL('../drizzle', import.meta.url))
}

export async function runMigrations(
  connection: Pick<DatabaseConnection, 'db'>,
  options: { readonly migrationsFolder?: string } = {},
): Promise<void> {
  await migrate(connection.db, {
    migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder(),
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  })
}

export async function inspectMigrationStatus(
  connection: Pick<DatabaseConnection, 'client'>,
  options: { readonly migrationsFolder?: string } = {},
): Promise<MigrationStatus> {
  const expected = readMigrationFiles({
    migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder(),
  })

  const tableExists = await connection.client<readonly { exists: boolean }[]>`
    select to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`}) is not null as exists
  `
  if (!tableExists[0]?.exists) {
    return {
      current: false,
      expectedCount: expected.length,
      appliedCount: 0,
      expectedLatestAt: expected.at(-1)?.folderMillis ?? null,
      appliedLatestAt: null,
      reason: 'missing',
    }
  }

  const applied = await connection.client<readonly { hash: string; createdAt: string | number }[]>`
    select hash, created_at as "createdAt"
    from browshare_internal.schema_migrations
    order by created_at asc, id asc
  `
  const expectedLatestAt = expected.at(-1)?.folderMillis ?? null
  const appliedLatestAt = applied.at(-1) ? Number(applied.at(-1)?.createdAt) : null

  if (applied.length < expected.length) {
    return {
      current: false,
      expectedCount: expected.length,
      appliedCount: applied.length,
      expectedLatestAt,
      appliedLatestAt,
      reason: 'behind',
    }
  }
  if (applied.length > expected.length) {
    return {
      current: false,
      expectedCount: expected.length,
      appliedCount: applied.length,
      expectedLatestAt,
      appliedLatestAt,
      reason: 'ahead',
    }
  }

  const diverged = expected.some((migration, index) => {
    const record = applied[index]
    return record?.hash !== migration.hash || Number(record.createdAt) !== migration.folderMillis
  })

  return {
    current: !diverged,
    expectedCount: expected.length,
    appliedCount: applied.length,
    expectedLatestAt,
    appliedLatestAt,
    reason: diverged ? 'diverged' : 'current',
  }
}

export async function assertMigrationsCurrent(
  connection: Pick<DatabaseConnection, 'client'>,
  options: { readonly migrationsFolder?: string } = {},
): Promise<MigrationStatus> {
  const status = await inspectMigrationStatus(connection, options)
  if (!status.current) {
    throw new Error(
      `BrowShare database migrations are not current: ${status.reason} ` +
        `(applied ${status.appliedCount}, expected ${status.expectedCount})`,
    )
  }
  return status
}
