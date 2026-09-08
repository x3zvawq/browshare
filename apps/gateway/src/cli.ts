#!/usr/bin/env node
import { createServiceLogger } from '@browshare/common'
import { loadGatewayConfiguration } from './configuration.js'
import { createGatewayRuntime } from './runtime.js'

const logger = createServiceLogger({ service: 'gateway', level: 'info' })
try {
  const configuration = loadGatewayConfiguration()
  const runtime = await createGatewayRuntime(configuration, logger)
  logger.info(
    { gatewayId: configuration.id, address: runtime.address, healthAddress: runtime.healthAddress },
    'Gateway started',
  )
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    void runtime.close().catch(() => {
      logger.error('Gateway shutdown failed')
      process.exitCode = 1
    })
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
} catch {
  logger.fatal(
    'Gateway startup failed; verify deployment configuration and coordinated Remote Tab packages',
  )
  process.exitCode = 1
}
