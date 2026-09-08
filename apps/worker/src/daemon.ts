import { closeNavigationScriptRuntime } from '@browshare/navigation-policy'
import { createServer, type Server } from 'node:http'

import { createPublicId, createServiceLogger, utcNow } from '@browshare/common'
import { BROWSHARE_VERSION, type HealthLive, type HealthReady } from '@browshare/contracts'

import type { WorkerConfiguration } from './configuration.js'
import type { WorkerControlClient } from './control-client.js'

interface WorkerRuntimeLifecycle {
  close(): Promise<void>
  getMediaMetrics?(): readonly string[]
}

type WorkerDaemonConfiguration = Pick<
  WorkerConfiguration,
  'name' | 'healthHost' | 'healthPort' | 'logLevel'
>

export class WorkerDaemon {
  readonly #configuration: WorkerDaemonConfiguration
  readonly #logger: ReturnType<typeof createServiceLogger>
  #server: Server | undefined
  #controlClient: WorkerControlClient | undefined
  #runtime: WorkerRuntimeLifecycle | undefined
  #closing = false

  constructor(configuration: WorkerDaemonConfiguration) {
    this.#configuration = configuration
    this.#logger = createServiceLogger({
      service: 'worker',
      level: configuration.logLevel,
      base: { version: BROWSHARE_VERSION, workerName: configuration.name },
    })
  }

  get logger(): ReturnType<typeof createServiceLogger> {
    return this.#logger
  }

  attachControlClient(controlClient: WorkerControlClient): void {
    if (this.#server !== undefined)
      throw new Error('Cannot attach Worker control after daemon start')
    if (this.#controlClient !== undefined)
      throw new Error('Worker control client is already attached')
    this.#controlClient = controlClient
  }

  attachRuntime(runtime: WorkerRuntimeLifecycle): void {
    if (this.#server !== undefined)
      throw new Error('Cannot attach Worker runtime after daemon start')
    if (this.#runtime !== undefined) throw new Error('Worker runtime is already attached')
    this.#runtime = runtime
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.#server !== undefined) throw new Error('Worker daemon is already started')
    const server = createServer((request, response) => {
      const requestId = createPublicId()
      response.setHeader('cache-control', 'no-store')
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('x-content-type-options', 'nosniff')
      response.setHeader('x-request-id', requestId)

      if (request.method === 'GET' && request.url === '/health/live') {
        const body: HealthLive = {
          status: 'ok',
          service: 'worker',
          version: BROWSHARE_VERSION,
          time: utcNow(),
        }
        response.writeHead(200)
        response.end(JSON.stringify(body))
        return
      }
      if (request.method === 'GET' && request.url === '/health/ready') {
        const backendControl = ['connected', 'reconciling'].includes(
          this.#controlClient?.state ?? '',
        )
          ? 'connected'
          : 'not-connected'
        const chromeRuntime = this.#controlClient?.runtimeReady === true ? 'ready' : 'probe-failed'
        const reconciliation = this.#controlClient?.state === 'connected' ? 'ready' : 'pending'
        const ready =
          backendControl === 'connected' && chromeRuntime === 'ready' && reconciliation === 'ready'
        const body: HealthReady = {
          status: ready ? 'ready' : 'not-ready',
          service: 'worker',
          version: BROWSHARE_VERSION,
          time: utcNow(),
          checks: {
            configuration: 'ready',
            backendControl,
            chromeRuntime,
            reconciliation,
          },
        }
        response.writeHead(ready ? 200 : 503)
        response.end(JSON.stringify(body))
        return
      }
      if (request.method === 'GET' && request.url === '/metrics') {
        const memory = process.memoryUsage()
        const state = this.#controlClient?.state ?? 'not-connected'
        const sample = this.#controlClient?.latestMetrics
        const latest = sample?.metrics
        const lines = [
          '# HELP browshare_worker_info Worker process information.',
          '# TYPE browshare_worker_info gauge',
          `browshare_worker_info{version="${escapeMetricLabel(BROWSHARE_VERSION)}",state="${escapeMetricLabel(state)}"} 1`,
          '# HELP browshare_worker_uptime_seconds Worker process uptime.',
          '# TYPE browshare_worker_uptime_seconds gauge',
          `browshare_worker_uptime_seconds ${process.uptime()}`,
          '# HELP browshare_worker_resident_memory_bytes Worker resident memory.',
          '# TYPE browshare_worker_resident_memory_bytes gauge',
          `browshare_worker_resident_memory_bytes ${memory.rss}`,
          '# HELP browshare_worker_runtime_ready Whether the Chrome runtime is ready.',
          '# TYPE browshare_worker_runtime_ready gauge',
          `browshare_worker_runtime_ready ${this.#controlClient?.runtimeReady === true ? 1 : 0}`,
        ]
        if (latest !== undefined && sample !== undefined) {
          lines.push(
            '# HELP browshare_worker_metrics_observed_timestamp_seconds Start time of the latest completed runtime sample; absent before the first sample.',
            '# TYPE browshare_worker_metrics_observed_timestamp_seconds gauge',
            `browshare_worker_metrics_observed_timestamp_seconds ${Date.parse(sample.observedAt) / 1000}`,
            '# HELP browshare_worker_cpu_utilization_percent Worker CPU utilization.',
            '# TYPE browshare_worker_cpu_utilization_percent gauge',
            `browshare_worker_cpu_utilization_percent ${latest.cpu.utilizationPercent}`,
            '# HELP browshare_worker_active_sessions Active managed Sessions.',
            '# TYPE browshare_worker_active_sessions gauge',
            `browshare_worker_active_sessions ${latest.runtime.activeSessions}`,
            '# HELP browshare_worker_tabs Managed Chrome tabs.',
            '# TYPE browshare_worker_tabs gauge',
            `browshare_worker_tabs ${latest.runtime.tabs}`,
            '# HELP browshare_worker_storage_available_bytes Available storage by purpose.',
            '# TYPE browshare_worker_storage_available_bytes gauge',
            '# HELP browshare_worker_storage_total_bytes Total storage by purpose.',
            '# TYPE browshare_worker_storage_total_bytes gauge',
          )
          for (const storage of latest.storage) {
            const purpose = escapeMetricLabel(storage.purpose)
            lines.push(
              `browshare_worker_storage_available_bytes{purpose="${purpose}"} ${storage.availableBytes}`,
              `browshare_worker_storage_total_bytes{purpose="${purpose}"} ${storage.totalBytes}`,
            )
          }
        }
        lines.push(...(this.#runtime?.getMediaMetrics?.() ?? []))
        response.setHeader('content-type', 'text/plain; version=0.0.4')
        response.writeHead(200)
        response.end(`${lines.join('\n')}\n`)
        return
      }

      response.writeHead(404)
      response.end(
        JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'The requested resource does not exist.',
            requestId,
          },
        }),
      )
    })
    this.#server = server

    await new Promise<void>((resolve, reject) => {
      const onError = (cause: Error) => {
        server.off('listening', onListening)
        reject(cause)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.#configuration.healthPort, this.#configuration.healthHost)
    })

    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Worker health listener has no TCP address')
    }
    this.#logger.info(
      { host: this.#configuration.healthHost, port: address.port },
      'Worker started',
    )
    try {
      await this.#controlClient?.start()
    } catch (cause) {
      await this.close()
      throw cause
    }
    return { host: this.#configuration.healthHost, port: address.port }
  }

  async close(): Promise<void> {
    if (this.#closing) return
    this.#closing = true
    const server = this.#server
    this.#server = undefined
    await this.#controlClient?.close()
    await this.#runtime?.close()
    await closeNavigationScriptRuntime()
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server.close((cause) => (cause === undefined ? resolve() : reject(cause)))
      })
    }
    this.#logger.info('Worker stopped')
  }
}

function escapeMetricLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
}
