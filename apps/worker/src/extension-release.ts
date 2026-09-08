import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'

import { createPublicId } from '@browshare/common'

import type { RemoteTabRuntimeConfiguration } from './configuration.js'

type ExtensionReleaseConfiguration = Pick<
  RemoteTabRuntimeConfiguration,
  | 'extensionCrxSha256'
  | 'extensionHost'
  | 'extensionId'
  | 'extensionReleaseDirectory'
  | 'extensionUpdatePort'
  | 'extensionVersion'
  | 'managedPolicyPath'
  | 'runtimeGeneration'
  | 'runtimeSecret'
>

export interface ExtensionReleaseAddress {
  readonly host: '127.0.0.1' | '::1'
  readonly port: number
  readonly updateManifestUrl: string
  readonly crxUrl: string
}

export class WorkerExtensionRelease {
  readonly #configuration: ExtensionReleaseConfiguration
  #server: Server | undefined

  constructor(configuration: ExtensionReleaseConfiguration) {
    this.#configuration = configuration
  }

  async start(loopback: {
    readonly host: '127.0.0.1' | '::1'
    readonly port: number
  }): Promise<ExtensionReleaseAddress> {
    if (this.#server !== undefined) throw new Error('Extension release service is already started')
    if (!Number.isInteger(loopback.port) || loopback.port < 1 || loopback.port > 65_535) {
      throw new RangeError('Extension loopback port must be an integer from 1 to 65535')
    }

    const crxName = `browshare-remote-tab-${this.#configuration.extensionVersion}.crx`
    const crx = await readFile(join(this.#configuration.extensionReleaseDirectory, crxName))
    assertCrxArtifact(crx, this.#configuration.extensionCrxSha256)

    const server = createServer((request, response) => {
      response.setHeader('x-content-type-options', 'nosniff')
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('allow', 'GET, HEAD')
        response.writeHead(405)
        response.end()
        return
      }

      const requestPath = parseRequestPath(request.url)

      if (requestPath === `/${crxName}`) {
        response.setHeader('cache-control', 'public, max-age=31536000, immutable')
        response.setHeader('content-type', 'application/x-chrome-extension')
        response.setHeader('content-length', crx.byteLength)
        response.writeHead(200)
        response.end(request.method === 'HEAD' ? undefined : crx)
        return
      }

      if (requestPath === '/updates.xml') {
        const source = createUpdateManifest(
          this.#configuration.extensionId,
          this.#configuration.extensionVersion,
          createLoopbackUrl(this.#configuration.extensionHost, addressPort(server), crxName),
        )
        response.setHeader('cache-control', 'no-store')
        response.setHeader('content-type', 'application/xml; charset=utf-8')
        response.setHeader('content-length', Buffer.byteLength(source))
        response.writeHead(200)
        response.end(request.method === 'HEAD' ? undefined : source)
        return
      }

      response.setHeader('cache-control', 'no-store')
      response.writeHead(404)
      response.end()
    })

    try {
      await listen(
        server,
        this.#configuration.extensionHost,
        this.#configuration.extensionUpdatePort,
      )
      const port = addressPort(server)
      const crxUrl = createLoopbackUrl(this.#configuration.extensionHost, port, crxName)
      const updateManifestUrl = createLoopbackUrl(
        this.#configuration.extensionHost,
        port,
        'updates.xml',
      )
      const policySource = createManagedPolicy({
        extensionId: this.#configuration.extensionId,
        updateManifestUrl,
        loopbackUrl: createLoopbackWebSocketUrl(loopback.host, loopback.port),
        runtimeSecret: this.#configuration.runtimeSecret,
        runtimeGeneration: this.#configuration.runtimeGeneration,
      })
      await writePolicyAtomically(this.#configuration.managedPolicyPath, policySource)
      this.#server = server
      return { host: this.#configuration.extensionHost, port, updateManifestUrl, crxUrl }
    } catch (cause) {
      await closeServer(server).catch(() => undefined)
      throw cause
    }
  }

  async close(): Promise<void> {
    const server = this.#server
    this.#server = undefined
    if (server === undefined) return
    let failure: unknown
    try {
      await unlink(this.#configuration.managedPolicyPath)
    } catch (cause) {
      if (!isMissingFile(cause)) failure = cause
    }
    try {
      await closeServer(server)
    } catch (cause) {
      failure ??= cause
    }
    if (failure !== undefined) throw failure
  }
}

function assertCrxArtifact(crx: Buffer, expectedSha256: string): void {
  if (crx.byteLength < 12 || crx.subarray(0, 4).toString('ascii') !== 'Cr24') {
    throw new TypeError('Remote Tab Extension artifact is not a CRX file')
  }
  if (crx.readUInt32LE(4) !== 3) {
    throw new TypeError('Remote Tab Extension artifact must use CRX3')
  }
  const actualSha256 = createHash('sha256').update(crx).digest('hex')
  if (actualSha256 !== expectedSha256) {
    throw new TypeError('Remote Tab Extension artifact SHA-256 does not match configuration')
  }
}

function createManagedPolicy(input: {
  readonly extensionId: string
  readonly updateManifestUrl: string
  readonly loopbackUrl: string
  readonly runtimeSecret: string
  readonly runtimeGeneration: string
}): string {
  return `${JSON.stringify(
    {
      ExtensionSettings: {
        [input.extensionId]: {
          installation_mode: 'force_installed',
          update_url: input.updateManifestUrl,
          override_update_url: true,
        },
      },
      '3rdparty': {
        extensions: {
          [input.extensionId]: {
            loopbackUrl: input.loopbackUrl,
            runtimeSecret: input.runtimeSecret,
            runtimeGeneration: input.runtimeGeneration,
          },
        },
      },
    },
    null,
    2,
  )}\n`
}

function createUpdateManifest(extensionId: string, version: string, crxUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n  <app appid="${extensionId}">\n    <updatecheck codebase="${crxUrl}" version="${version}" />\n  </app>\n</gupdate>\n`
}

function createLoopbackUrl(host: '127.0.0.1' | '::1', port: number, path = ''): string {
  const hostname = host === '::1' ? '[::1]' : host
  return `http://${hostname}:${port}/${path}`
}

function createLoopbackWebSocketUrl(host: '127.0.0.1' | '::1', port: number): string {
  const hostname = host === '::1' ? '[::1]' : host
  return `ws://${hostname}:${port}`
}

function parseRequestPath(target: string | undefined): string | undefined {
  if (target === undefined) return undefined
  try {
    return new URL(target, 'http://127.0.0.1').pathname
  } catch {
    return undefined
  }
}

async function writePolicyAtomically(path: string, source: string): Promise<void> {
  const directory = dirname(path)
  const temporaryPath = join(directory, `.browshare-remote-tab-${createPublicId()}.json`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporaryPath, source, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporaryPath, path)
  } catch (cause) {
    await unlink(temporaryPath).catch(() => undefined)
    throw cause
  }
}

async function listen(server: Server, host: string, port: number): Promise<void> {
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
    server.listen(port, host)
  })
}

function addressPort(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Extension release listener has no TCP address')
  }
  return address.port
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((cause) => (cause === undefined ? resolve() : reject(cause)))
  })
}

function isMissingFile(cause: unknown): boolean {
  return (
    cause instanceof Error && 'code' in cause && (cause as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
