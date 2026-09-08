#!/usr/bin/env node

import { connectDatabase } from './client.js'
import { loadDatabaseConfiguration } from './configuration.js'
import { runMigrations } from './migrate.js'

async function main(): Promise<void> {
  const configuration = loadDatabaseConfiguration()
  const connection = connectDatabase(configuration.url, {
    applicationName: 'browshare-migrator',
    maxConnections: 1,
  })

  try {
    await runMigrations(connection)
    process.stdout.write('BrowShare database migrations are up to date.\n')
  } finally {
    await connection.close()
  }
}

await main()
