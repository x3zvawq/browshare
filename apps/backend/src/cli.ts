#!/usr/bin/env node
import { createServiceLogger } from '@browshare/common'
import type { BackendApp } from './app.js'
import { loadBackendConfiguration } from './configuration.js'
import { createBackendRuntime } from './runtime.js'

const startupLogger = createServiceLogger({ service: 'backend' })
let app: BackendApp | undefined

try {
  const configuration = loadBackendConfiguration()
  const runtime = await createBackendRuntime(configuration)
  app = runtime.app
  const runningApp = app

  if (runtime.bootstrap.outcome === 'initialized') {
    app.log.info(
      { administratorUserId: runtime.bootstrap.administratorUserId },
      'BrowShare bootstrap completed',
    )
  } else if (runtime.bootstrap.outcome === 'uninitialized') {
    app.log.warn(
      configuration.bootstrapToken === undefined
        ? 'BrowShare has not been initialized; configure administrator credentials or an initialization token'
        : 'BrowShare has not been initialized; open the Portal setup page to create the administrator',
    )
  }

  const close = async (signal: NodeJS.Signals) => {
    runningApp.log.info({ signal }, 'Backend is shutting down')
    await runningApp.close()
    process.exitCode = 0
  }

  process.once('SIGINT', () => void close('SIGINT'))
  process.once('SIGTERM', () => void close('SIGTERM'))

  await app.listen({ host: configuration.host, port: configuration.port })
  await runtime.workerControl.start()
} catch (cause) {
  ;(app?.log ?? startupLogger).fatal({ err: cause }, 'Backend failed to start')
  process.exitCode = 1
  await app?.close()
}
