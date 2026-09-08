import type { DatabaseConnection } from '@browshare/database'
import { inspectMigrationStatus } from '@browshare/database'

import { inspectBootstrapState } from './bootstrap.js'

export interface ReadinessSnapshot {
  readonly status: 'ready' | 'not-ready'
  readonly checks: Readonly<Record<string, string>>
}

export type ReadinessProbe = () => Promise<ReadinessSnapshot>

export function createDatabaseReadinessProbe(
  connection: Pick<DatabaseConnection, 'client'>,
): ReadinessProbe {
  return async () => {
    try {
      const migrations = await inspectMigrationStatus(connection)
      if (!migrations.current) {
        return {
          status: 'not-ready',
          checks: {
            process: 'ready',
            configuration: 'ready',
            database: 'reachable',
            migrations: `${migrations.reason}:${migrations.appliedCount}/${migrations.expectedCount}`,
            bootstrap: 'unknown',
          },
        }
      }

      const bootstrap = await inspectBootstrapState(connection)
      const bootstrapCheck = bootstrap.completed
        ? 'initialized'
        : bootstrap.userCount === 0
          ? 'uninitialized'
          : 'inconsistent'

      return {
        status: bootstrapCheck === 'inconsistent' ? 'not-ready' : 'ready',
        checks: {
          process: 'ready',
          configuration: 'ready',
          database: 'reachable',
          migrations: `current:${migrations.appliedCount}/${migrations.expectedCount}`,
          bootstrap: bootstrapCheck,
        },
      }
    } catch {
      return {
        status: 'not-ready',
        checks: {
          process: 'ready',
          configuration: 'ready',
          database: 'not-reachable',
          migrations: 'unknown',
          bootstrap: 'unknown',
        },
      }
    }
  }
}

export const schemaReadinessProbe: ReadinessProbe = async () => ({
  status: 'ready',
  checks: {
    process: 'ready',
    configuration: 'schema-only',
    database: 'schema-only',
    migrations: 'schema-only',
    bootstrap: 'schema-only',
  },
})
