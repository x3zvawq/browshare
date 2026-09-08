#!/usr/bin/env node
import { createPublicId, createServiceLogger } from '@browshare/common'
import { loadWorkerConfiguration } from './configuration.js'
import { WorkerControlClient } from './control-client.js'
import { WorkerDaemon } from './daemon.js'
import { ensureWorkerIdentity } from './identity.js'
import { createEmbeddedRemoteTabRuntime } from './remote-tab-runtime.js'
import { WorkerRuntimeMonitor } from './runtime-monitor.js'

const startupLogger = createServiceLogger({ service: 'worker' })
let daemon: WorkerDaemon | undefined

try {
  // Container restarts retain configuration files; the Extension generation must not survive
  // the process that owns its loopback connection and Managed Policy.
  const configuration = loadWorkerConfiguration({
    ...process.env,
    BROWSHARE_REMOTE_TAB_RUNTIME_GENERATION: createPublicId(),
  })
  daemon = new WorkerDaemon(configuration)
  const runningDaemon = daemon
  const close = async (signal: NodeJS.Signals) => {
    runningDaemon.logger.info({ signal }, 'Worker is shutting down')
    await runningDaemon.close()
    process.exitCode = 0
  }
  process.once('SIGINT', () => void close('SIGINT'))
  process.once('SIGTERM', () => void close('SIGTERM'))

  const workerIdentity = await ensureWorkerIdentity(configuration)
  daemon.logger.info(
    { workerId: workerIdentity.identity.workerId, identityOutcome: workerIdentity.outcome },
    workerIdentity.outcome === 'enrolled'
      ? 'Worker enrollment completed'
      : workerIdentity.outcome === 'rotated'
        ? 'Worker credential rotation completed'
        : 'Worker identity loaded',
  )
  const remoteTabRuntime = await createEmbeddedRemoteTabRuntime(configuration)
  if (remoteTabRuntime !== undefined) daemon.attachRuntime(remoteTabRuntime)
  const runtimeMonitor = new WorkerRuntimeMonitor(configuration, remoteTabRuntime)
  const capabilityReport = await runtimeMonitor.initialize()
  daemon.logger.info(
    {
      probeStatus: capabilityReport.status,
      probeErrorCodes: capabilityReport.checks
        .filter((check) => check.status !== 'PASS')
        .map((check) => check.code),
    },
    'Worker capability probe completed',
  )
  daemon.attachControlClient(
    new WorkerControlClient(
      configuration,
      workerIdentity.identity,
      daemon.logger,
      runtimeMonitor,
      remoteTabRuntime,
      remoteTabRuntime,
      remoteTabRuntime?.retainedDownloads,
    ),
  )
  await daemon.start()
} catch (cause) {
  ;(daemon?.logger ?? startupLogger).fatal({ err: cause }, 'Worker failed to start')
  process.exitCode = 1
  await daemon?.close()
}
