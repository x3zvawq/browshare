import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { GatewayCoreAuthorizationRequest, GatewayViewerClaims } from '@browshare/contracts'
import { createServiceLogger } from '@browshare/common'
import { createGatewayDiagnosticSink } from './diagnostics.js'
import { GatewayBackendClient } from './backend-client.js'
import type { GatewayConfiguration } from './configuration.js'
import { createIceServerProvider, type GatewayIceServerProvider } from './ice-server-provider.js'

interface SignalingPort {
  start(): Promise<{ host: string; port: number }>
  close(): Promise<void>
  getMetrics(): {
    connectionsActive: number
    maximumConnections: number
    pairsTracked: number
    maximumPendingPairs: number
  }
}
interface SignalingModule {
  SignalingGateway: new (options: {
    configuration: Record<string, unknown>
    viewerTicketVerifier: {
      verifyViewerTicket(ticket: string): Promise<{ claims: GatewayViewerClaims }>
    }
    coreBindingAuthorizer: {
      authorizeCoreBinding(input: GatewayCoreAuthorizationRequest): Promise<boolean>
    }
    iceServerProvider: GatewayIceServerProvider
    onDiagnostic(event: unknown): void
  }) => SignalingPort
}

export async function createGatewayRuntime(
  configuration: GatewayConfiguration,
  logger: Pick<ReturnType<typeof createServiceLogger>, 'info' | 'warn'> = createServiceLogger({
    service: 'gateway',
  }),
) {
  // The coordinated image supplies the sibling repository's engine, as on Worker.
  const entry = import.meta.resolve('@browshare/remote-tab-signaling')
  const engine = (await import(entry)) as SignalingModule
  if (typeof engine.SignalingGateway !== 'function')
    throw new Error('Remote Tab Signaling Gateway export is unavailable')
  const protocol = (await import(import.meta.resolve('@browshare/remote-tab-protocol'))) as {
    REMOTE_TAB_ERROR_CODES: readonly string[]
  }
  if (
    !Array.isArray(protocol.REMOTE_TAB_ERROR_CODES) ||
    !protocol.REMOTE_TAB_ERROR_CODES.every((code) => typeof code === 'string')
  )
    throw new Error('Remote Tab error code export is unavailable')
  const backend = new GatewayBackendClient(configuration)
  const gateway = new engine.SignalingGateway({
    configuration: {
      gatewayId: configuration.id,
      host: configuration.host,
      port: configuration.port,
      publicEndpoint: configuration.publicEndpoint,
      pairingTimeoutMs: 30000,
      maxMessageBytes: 262144,
      maxConnections: configuration.maxConnections,
      maxConnectionsPerIp: configuration.maxConnectionsPerIp,
      maxPendingPairs: configuration.maxPendingPairs,
      messageRateWindowMs: 60000,
      maxMessagesPerWindow: 1200,
      maxConsumedTickets: 100000,
      iceTransportPolicy: configuration.iceTransportPolicy,
    },
    viewerTicketVerifier: { verifyViewerTicket: (ticket) => backend.consumeTicket(ticket) },
    coreBindingAuthorizer: { authorizeCoreBinding: (input) => backend.authorizeCore(input) },
    iceServerProvider: createIceServerProvider(configuration),
    onDiagnostic: createGatewayDiagnosticSink(
      configuration.id,
      logger,
      protocol.REMOTE_TAB_ERROR_CODES,
    ),
  })
  const address = await gateway.start()
  const health = createServer((request, response) => {
    if (request.method !== 'GET' || !['/health/ready', '/metrics'].includes(request.url ?? '')) {
      response.writeHead(404)
      response.end()
      return
    }
    const actual = Buffer.from(request.headers.authorization ?? ''),
      expected = Buffer.from('Bearer ' + configuration.secret)
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
      response.writeHead(401)
      response.end()
      return
    }
    if (request.url === '/metrics') {
      const metrics = gateway.getMetrics()
      response.writeHead(200, {
        'content-type': 'text/plain; version=0.0.4',
        'cache-control': 'no-store',
      })
      response.end(
        [
          '# HELP browshare_gateway_connections_active Active Gateway connections.',
          '# TYPE browshare_gateway_connections_active gauge',
          `browshare_gateway_connections_active ${metrics.connectionsActive}`,
          '# HELP browshare_gateway_pairs_tracked Pending signaling pairs.',
          '# TYPE browshare_gateway_pairs_tracked gauge',
          `browshare_gateway_pairs_tracked ${metrics.pairsTracked}`,
          '# HELP browshare_gateway_maximum_connections Configured connection limit.',
          '# TYPE browshare_gateway_maximum_connections gauge',
          `browshare_gateway_maximum_connections ${metrics.maximumConnections}`,
          '# HELP browshare_gateway_maximum_pending_pairs Configured pending pair limit.',
          '# TYPE browshare_gateway_maximum_pending_pairs gauge',
          `browshare_gateway_maximum_pending_pairs ${metrics.maximumPendingPairs}`,
        ].join('\n') + '\n',
      )
      return
    }
    void backend
      .ready()
      .then((available) => {
        const metrics = gateway.getMetrics()
        const ready =
          available &&
          metrics.connectionsActive + 2 <= metrics.maximumConnections &&
          metrics.pairsTracked < metrics.maximumPendingPairs
        response.writeHead(ready ? 200 : 503, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify({ gatewayId: configuration.id, protocolVersion: 1, ready }))
      })
      .catch(() => {
        response.writeHead(503)
        response.end()
      })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      health.once('error', reject)
      health.listen(configuration.healthPort, configuration.healthHost, () => {
        health.off('error', reject)
        resolve()
      })
    })
  } catch (cause) {
    await gateway.close()
    throw cause
  }
  let closing: Promise<void> | undefined
  return {
    address,
    healthAddress: health.address() as AddressInfo,
    close(): Promise<void> {
      closing ??= Promise.all([
        gateway.close(),
        new Promise<void>((resolve, reject) =>
          health.close((error) => (error ? reject(error) : resolve())),
        ),
      ]).then(() => undefined)
      return closing
    },
  }
}
