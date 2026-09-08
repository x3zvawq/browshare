import { request as httpRequest, type ClientRequest } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { isIP, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

import { assertProxyCredentials, normalizeProxyHost } from '@browshare/common'
import { Server as ProxyServer } from 'proxy-chain'

import { assertProxyDestination, lookupProxyDestination } from './proxy-destination.js'

export type ProfileProxyConfiguration =
  | { readonly type: 'DIRECT' }
  | {
      readonly type: 'HTTP' | 'HTTPS' | 'SOCKS5'
      readonly host: string
      readonly port: number
      readonly username: string | null
      readonly password: string | null
    }

export interface ProxyAdapterAddress {
  readonly host: '127.0.0.1'
  readonly port: number
  readonly url: string
}

export interface ProxyHealthResult {
  readonly status: 'HEALTHY' | 'UNHEALTHY'
  readonly checkedAt: string
  readonly latencyMilliseconds: number
  readonly httpStatus: number | null
  readonly errorCode:
    | 'PROXY_CONNECT_FAILED'
    | 'PROXY_TLS_FAILED'
    | 'PROXY_HTTP_FAILED'
    | 'PROXY_CHECK_TIMEOUT'
    | 'PROXY_CHECK_CANCELLED'
    | 'PROXY_RESPONSE_INVALID'
    | null
}

export interface ProxyExitIpResult extends ProxyHealthResult {
  readonly exitIp: string | null
}

/** One Profile Runtime owns one immutable route and closes it with its Chrome. */
export class ProfileProxyAdapter {
  readonly #server: ProxyServer
  readonly #checks = new Set<AbortController>()
  #startPromise: Promise<ProxyAdapterAddress> | undefined
  #closePromise: Promise<void> | undefined
  #address: ProxyAdapterAddress | undefined
  #closed = false

  constructor(configuration: ProfileProxyConfiguration) {
    const upstreamProxyUrl = buildUpstreamUrl(configuration)
    this.#server = new ProxyServer({
      host: '127.0.0.1',
      port: 0,
      verbose: false,
      // A network configuration always produces a nonempty URL. Failed
      // authentication, DNS, TLS or connects can never select the Direct branch.
      prepareRequestFunction: ({ hostname }) => {
        assertProxyDestination(hostname)
        return {
          upstreamProxyUrl,
          // Upstream DNS resolves the explicitly configured Proxy endpoint;
          // destination DNS remains at the selected upstream, including SOCKS.
          ...(upstreamProxyUrl === null ? { dnsLookup: lookupProxyDestination } : {}),
        }
      },
    })
  }

  start(): Promise<ProxyAdapterAddress> {
    if (this.#closed) return Promise.reject(new Error('Proxy Adapter is closed'))
    this.#startPromise ??= this.#server.listen().then(() => {
      this.#address = {
        host: '127.0.0.1',
        port: this.#server.port,
        url: `http://127.0.0.1:${this.#server.port}`,
      }
      return this.#address
    })
    return this.#startPromise
  }

  get address(): ProxyAdapterAddress {
    if (this.#address === undefined || this.#closed) throw new Error('Proxy Adapter is not running')
    return this.#address
  }

  get connectionCount(): number {
    return this.#server.getConnectionIds().length
  }

  async checkHealth(url: string, timeoutMilliseconds = 10_000): Promise<ProxyHealthResult> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Health facts intentionally omit exit-IP discovery.
    const { exitIp: _exitIp, ...health } = await this.#probe(url, timeoutMilliseconds, 'health')
    return health
  }

  checkExitIp(url: string, timeoutMilliseconds = 10_000): Promise<ProxyExitIpResult> {
    return this.#probe(url, timeoutMilliseconds, 'exit-ip')
  }

  cancelChecks(): void {
    for (const check of this.#checks) check.abort()
  }

  async #probe(
    url: string,
    timeoutMilliseconds: number,
    mode: 'health' | 'exit-ip',
  ): Promise<ProxyExitIpResult> {
    const endpoint = this.address
    const target = new URL(url)
    if (target.protocol !== 'https:' || target.username || target.password) {
      throw new TypeError('Proxy health checks require an HTTPS URL without credentials')
    }
    if (
      !Number.isInteger(timeoutMilliseconds) ||
      timeoutMilliseconds < 1 ||
      timeoutMilliseconds > 120_000
    ) {
      throw new RangeError('Proxy health check timeout must be between 1 and 120000 milliseconds')
    }
    const controller = new AbortController()
    this.#checks.add(controller)
    const deadline = AbortSignal.timeout(timeoutMilliseconds)
    try {
      return await probeThroughAdapter(
        endpoint,
        target,
        AbortSignal.any([controller.signal, deadline]),
        deadline,
        mode,
      )
    } finally {
      this.#checks.delete(controller)
    }
  }

  close(): Promise<void> {
    this.#closed = true
    this.cancelChecks()
    this.#closePromise ??= (async () => {
      await this.#startPromise?.catch(() => undefined)
      if (this.#server.server.listening) {
        // Server.close can settle before socket close events finish removing
        // connection records. Await both so Runtime teardown is observable.
        const drained = Promise.all(
          [...this.#server.connections.values()].map(
            (socket) => new Promise<void>((resolve) => socket.once('close', () => resolve())),
          ),
        )
        await this.#server.close(true)
        await drained
      }
      this.#address = undefined
    })()
    return this.#closePromise
  }
}

function buildUpstreamUrl(configuration: ProfileProxyConfiguration): string | null {
  if (configuration.type === 'DIRECT') return null
  if (!['HTTP', 'HTTPS', 'SOCKS5'].includes(configuration.type)) {
    throw new TypeError('Unsupported Proxy type')
  }
  const host = normalizeProxyHost(configuration.host)
  if (
    !Number.isInteger(configuration.port) ||
    configuration.port < 1 ||
    configuration.port > 65_535
  ) {
    throw new RangeError('Proxy port must be between 1 and 65535')
  }
  assertProxyCredentials(configuration.type, configuration.username, configuration.password)
  // socks5h keeps destination DNS at the selected upstream for HTTP as well
  // as CONNECT traffic. Plain socks5 can resolve destinations on the Worker.
  const scheme = configuration.type === 'SOCKS5' ? 'socks5h' : configuration.type.toLowerCase()
  const url = new URL(`${scheme}://${isIP(host) === 6 ? `[${host}]` : host}:${configuration.port}`)
  url.username = configuration.username ?? ''
  url.password = configuration.password ?? ''
  return url.href
}

function probeThroughAdapter(
  endpoint: ProxyAdapterAddress,
  target: URL,
  signal: AbortSignal,
  deadline: AbortSignal,
  mode: 'health' | 'exit-ip',
): Promise<ProxyExitIpResult> {
  const startedAt = performance.now()
  const hostname = target.hostname.replace(/^\[|\]$/gu, '')
  const authority = `${target.hostname}:${target.port || '443'}`
  return new Promise((resolve) => {
    let probe: ClientRequest | undefined
    let tunnel: Socket | undefined
    let agent: HttpsAgent | undefined
    let finished = false
    const finish = (
      errorCode: ProxyHealthResult['errorCode'],
      httpStatus: number | null = null,
      exitIp: string | null = null,
    ) => {
      if (finished) return
      finished = true
      signal.removeEventListener('abort', abort)
      connect.destroy()
      probe?.destroy()
      agent?.destroy()
      tunnel?.destroy()
      resolve({
        status: errorCode === null ? 'HEALTHY' : 'UNHEALTHY',
        checkedAt: new Date().toISOString(),
        latencyMilliseconds: Math.round(performance.now() - startedAt),
        httpStatus,
        errorCode,
        exitIp,
      })
    }
    const abort = () => finish(deadline.aborted ? 'PROXY_CHECK_TIMEOUT' : 'PROXY_CHECK_CANCELLED')
    const connect = httpRequest({
      hostname: endpoint.host,
      port: endpoint.port,
      method: 'CONNECT',
      path: authority,
      headers: { host: authority },
      agent: false,
    })
    connect.on('error', () => finish('PROXY_CONNECT_FAILED'))
    connect.on('connect', (response, socket, head) => {
      tunnel = socket
      if (finished) {
        socket.destroy()
        return
      }
      if (response.statusCode !== 200) {
        finish('PROXY_CONNECT_FAILED', response.statusCode ?? null)
        return
      }
      if (head.length) socket.unshift(head)
      agent = new HttpsAgent({ keepAlive: false })
      // TLS validates the actual target over the already-established adapter
      // tunnel; the health probe never opens a separate direct target socket.
      agent.createConnection = () =>
        tlsConnect({
          socket,
          host: hostname,
          servername: isIP(hostname) === 0 ? hostname : '',
          rejectUnauthorized: true,
          ALPNProtocols: ['http/1.1'],
        })
      probe = httpsRequest(target, { agent, method: 'GET', signal }, (result) => {
        const status = result.statusCode ?? 0
        if (mode === 'health') {
          finish(status >= 200 && status < 400 ? null : 'PROXY_HTTP_FAILED', status)
          result.destroy()
          return
        }
        // Exit-IP requests are explicit, bounded JSON reads. Never follow redirects or
        // preserve service response text in errors, logs, command results or Runtime facts.
        if (status < 200 || status >= 300) {
          finish('PROXY_HTTP_FAILED', status)
          result.destroy()
          return
        }
        let length = 0
        const chunks: Buffer[] = []
        result.on('data', (chunk: Buffer) => {
          if (finished) return
          length += chunk.length
          if (length > 4 * 1024) {
            chunks.length = 0
            // Destroy may synchronously emit aborted. Preserve the response failure first.
            finish('PROXY_RESPONSE_INVALID', status)
            result.destroy()
          } else chunks.push(chunk)
        })
        result.on('error', () => finish('PROXY_CONNECT_FAILED', status))
        result.on('aborted', () => finish('PROXY_CONNECT_FAILED', status))
        result.on('end', () => {
          if (finished) return
          let ip: unknown
          try {
            const value: unknown = JSON.parse(Buffer.concat(chunks, length).toString('utf8'))
            if (value !== null && typeof value === 'object' && !Array.isArray(value))
              ip = (value as { ip?: unknown }).ip
          } catch {
            /* Only a fixed response error leaves the Adapter. */
          }
          chunks.length = 0
          if (typeof ip !== 'string' || isIP(ip) === 0) finish('PROXY_RESPONSE_INVALID', status)
          else finish(null, status, ip)
        })
      })
      probe.on('error', (error: NodeJS.ErrnoException) => {
        if (signal.aborted) {
          abort()
          return
        }
        const tlsError =
          error.code?.includes('CERT') || error.code?.includes('TLS') || error.code?.includes('SSL')
        finish(tlsError ? 'PROXY_TLS_FAILED' : 'PROXY_CONNECT_FAILED')
      })
      probe.end()
    })
    connect.on('response', (response) => {
      finish('PROXY_CONNECT_FAILED', response.statusCode ?? null)
      response.destroy()
    })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else connect.end()
  })
}
