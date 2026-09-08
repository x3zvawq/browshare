import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema/index.js'

export interface DatabaseConnectionOptions {
  readonly applicationName?: string
  readonly maxConnections?: number
  readonly idleTimeoutSeconds?: number
  readonly connectTimeoutSeconds?: number
  readonly onNotice?: (notice: unknown) => void
}

export interface DatabaseConnection {
  readonly db: PostgresJsDatabase<typeof schema>
  readonly client: ReturnType<typeof postgres>
  close(): Promise<void>
}

export function connectDatabase(
  url: string,
  options: DatabaseConnectionOptions = {},
): DatabaseConnection {
  const client = postgres(url, {
    connection: { application_name: options.applicationName ?? 'browshare' },
    max: options.maxConnections ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    onnotice: options.onNotice ?? (() => undefined),
  })
  const db = drizzle(client, { schema })

  return {
    db,
    client,
    async close(): Promise<void> {
      await client.end({ timeout: 5 })
    },
  }
}
