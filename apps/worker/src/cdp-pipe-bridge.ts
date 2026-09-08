import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Readable, Writable } from 'node:stream'

import { WebSocketServer, type WebSocket } from 'ws'

const MAX_MESSAGE_BYTES = 16 * 1024 * 1024
const MAX_QUEUED_BYTES = 2 * MAX_MESSAGE_BYTES
const MAX_PENDING_COMMANDS = 16_384
const COMMAND_TIMEOUT_MILLISECONDS = 300_000

type Message = Record<string, unknown>
interface Client {
  readonly socket: WebSocket
  readonly ready: Promise<void>
  readonly pendingIds: Set<number>
  browserId: string | undefined
  closed: boolean
}
interface PendingCommand {
  readonly timer: ReturnType<typeof setTimeout>
  readonly client: Client | undefined
  readonly originalId: number | undefined
  readonly resolve: ((result: Message) => void) | undefined
  readonly reject: ((error: Error) => void) | undefined
}

export class CdpPipeError extends Error {
  constructor(readonly code: string) {
    super('The owned Chrome debugging pipe is unavailable')
    this.name = 'CdpPipeError'
  }
}

/** Private Node-only CDP transport. Chrome itself never opens an HTTP debugger. */
export class CdpPipeBridge {
  readonly #readable: Readable
  readonly #writable: Writable
  readonly #onFailure: () => void
  readonly #server: Server
  readonly #webSockets: WebSocketServer
  readonly #path = Buffer.from(`/cdp/${randomBytes(32).toString('hex')}`)
  readonly #clients = new Set<Client>()
  readonly #owners = new Map<string, Client>()
  readonly #pending = new Map<number, PendingCommand>()
  #buffer: Buffer = Buffer.alloc(0)
  #serial = 0
  #closed = false
  #backpressured = false
  #startPromise: Promise<string> | undefined
  #closePromise: Promise<void> | undefined

  constructor(readable: Readable, writable: Writable, onFailure: () => void) {
    this.#readable = readable
    this.#writable = writable
    this.#onFailure = onFailure
    this.#server = createServer((_request, response) => {
      response.writeHead(404, { 'content-length': '0' })
      response.end()
    })
    this.#server.requestTimeout = 5_000
    this.#server.headersTimeout = 5_000
    this.#webSockets = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
    })
    this.#server.on('upgrade', (request, socket, head) => {
      const path = Buffer.from(request.url ?? '')
      // Pages cannot suppress WebSocket Origin. The private path additionally
      // prevents local Proxy routes from turning the listener into an open CDP API.
      if (
        this.#closed ||
        request.headers.origin !== undefined ||
        path.length !== this.#path.length ||
        !timingSafeEqual(path, this.#path)
      ) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        return
      }
      this.#webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        this.#accept(webSocket)
      })
    })
    this.#server.on('error', () => this.#fail('CDP_BRIDGE_FAILED'))
    readable.on('data', (chunk: Buffer) => this.#read(chunk))
    readable.on('end', () => this.#fail('CDP_PIPE_CLOSED'))
    readable.on('error', () => this.#fail('CDP_PIPE_FAILED'))
    writable.on('error', () => this.#fail('CDP_PIPE_FAILED'))
    writable.on('drain', () => {
      this.#backpressured = false
      for (const client of this.#clients) client.socket.resume()
    })
  }

  start(): Promise<string> {
    if (this.#closed) return Promise.reject(new CdpPipeError('CDP_PIPE_CLOSED'))
    this.#startPromise ??= new Promise<string>((resolve, reject) => {
      const failed = () => reject(new CdpPipeError('CDP_BRIDGE_FAILED'))
      this.#server.once('error', failed)
      this.#server.listen(0, '127.0.0.1', () => {
        this.#server.off('error', failed)
        if (this.#closed) {
          reject(new CdpPipeError('CDP_PIPE_CLOSED'))
          return
        }
        const address = this.#server.address() as AddressInfo
        resolve(`ws://127.0.0.1:${address.port}${this.#path.toString()}`)
      })
    })
    return this.#startPromise
  }

  async getVersion(timeoutMilliseconds: number, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new CdpPipeError('CDP_PIPE_CANCELLED')
    const abort = () => this.#fail('CDP_PIPE_CANCELLED')
    signal.addEventListener('abort', abort, { once: true })
    try {
      const version = await this.#call('Browser.getVersion', {}, timeoutMilliseconds)
      if (typeof version.product !== 'string') throw new CdpPipeError('CDP_PIPE_INVALID_MESSAGE')
      return version.product
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  async closeBrowser(timeoutMilliseconds: number): Promise<void> {
    await this.#call('Browser.close', {}, timeoutMilliseconds).catch(() => undefined)
  }

  close(): Promise<void> {
    this.#closed = true
    this.#closePromise ??= (async () => {
      for (const [id, pending] of this.#pending) {
        this.#pending.delete(id)
        clearTimeout(pending.timer)
        pending.reject?.(new CdpPipeError('CDP_PIPE_CLOSED'))
      }
      for (const client of this.#clients) {
        client.closed = true
        client.socket.terminate()
      }
      this.#clients.clear()
      this.#owners.clear()
      this.#buffer = Buffer.alloc(0)
      this.#readable.destroy()
      this.#writable.destroy()
      await this.#startPromise?.catch(() => undefined)
      await Promise.all([
        new Promise<void>((resolve) => this.#webSockets.close(() => resolve())),
        new Promise<void>((resolve) => {
          this.#server.closeAllConnections()
          this.#server.close(() => resolve())
        }),
      ])
    })()
    return this.#closePromise
  }

  #fail(code: string): void {
    if (this.#closed) return
    for (const pending of this.#pending.values()) pending.reject?.(new CdpPipeError(code))
    void this.close()
    this.#onFailure()
  }

  #accept(socket: WebSocket): void {
    // One browser-target session per connection preserves native Chrome client
    // subscriptions. Sharing one browser session would mix autoAttach and downloads.
    const client: Client = {
      socket,
      browserId: undefined,
      closed: false,
      pendingIds: new Set(),
      ready: this.#call('Target.attachToBrowserTarget').then(async (result) => {
        if (typeof result.sessionId !== 'string') throw new CdpPipeError('CDP_PIPE_INVALID_MESSAGE')
        client.browserId = result.sessionId
        if (client.closed) {
          await this.#detach(client)
          return
        }
        this.#owners.set(result.sessionId, client)
      }),
    }
    this.#clients.add(client)
    if (this.#backpressured) socket.pause()
    void client.ready.catch(() => this.#fail('CDP_PIPE_ATTACH_FAILED'))
    socket.on('error', () => this.#drop(client))
    socket.on('close', () => this.#drop(client))
    socket.on('message', (bytes, isBinary) => {
      // Keep handshake buffering in ws/Node's bounded stream rather than making
      // an unbounded promise queue while Chrome is paused during startup.
      socket.pause()
      void client.ready
        .then(() => {
          if (client.closed) return
          if (isBinary) throw new CdpPipeError('CDP_PIPE_INVALID_MESSAGE')
          const message = parseMessage(bytes.toString())
          if (
            !Number.isSafeInteger(message.id) ||
            (message.id as number) < 0 ||
            typeof message.method !== 'string' ||
            (message.sessionId !== undefined &&
              (typeof message.sessionId !== 'string' ||
                this.#owners.get(message.sessionId) !== client)) ||
            client.pendingIds.has(message.id as number)
          ) {
            throw new CdpPipeError('CDP_PIPE_INVALID_MESSAGE')
          }
          const originalId = message.id as number
          const id = this.#nextId()
          client.pendingIds.add(originalId)
          const timer = setTimeout(() => this.#drop(client), COMMAND_TIMEOUT_MILLISECONDS)
          this.#pending.set(id, {
            timer,
            client,
            originalId,
            resolve: undefined,
            reject: undefined,
          })
          this.#write({ ...message, id, sessionId: message.sessionId ?? client.browserId })
        })
        .catch(() => this.#drop(client))
        .finally(() => {
          if (!client.closed && !this.#backpressured) socket.resume()
        })
    })
  }

  #drop(client: Client): void {
    if (client.closed) return
    client.closed = true
    client.socket.terminate()
    this.#clients.delete(client)
    for (const [id, pending] of this.#pending) {
      if (pending.client !== client) continue
      clearTimeout(pending.timer)
      this.#pending.delete(id)
    }
    client.pendingIds.clear()
    for (const [sessionId, owner] of this.#owners) {
      if (owner === client) this.#owners.delete(sessionId)
    }
    if (client.browserId !== undefined) void this.#detach(client)
  }

  async #detach(client: Client): Promise<void> {
    if (this.#closed) return
    try {
      await this.#call('Target.detachFromTarget', { sessionId: client.browserId })
    } catch {
      // A lost detach can leave paused child targets alive. End this owned
      // Chrome instead of claiming that its disconnected Core client was removed.
      this.#fail('CDP_PIPE_DETACH_FAILED')
    }
  }

  #nextId(): number {
    if (this.#closed) throw new CdpPipeError('CDP_PIPE_CLOSED')
    if (this.#pending.size >= MAX_PENDING_COMMANDS || this.#serial >= Number.MAX_SAFE_INTEGER) {
      throw new CdpPipeError('CDP_PIPE_CAPACITY')
    }
    return ++this.#serial
  }

  #call(
    method: string,
    params: Message = {},
    timeoutMilliseconds = COMMAND_TIMEOUT_MILLISECONDS,
  ): Promise<Message> {
    return new Promise((resolve, reject) => {
      const id = this.#nextId()
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new CdpPipeError('CDP_PIPE_TIMEOUT'))
      }, timeoutMilliseconds)
      this.#pending.set(id, {
        timer,
        client: undefined,
        originalId: undefined,
        resolve,
        reject,
      })
      try {
        this.#write({ id, method, params })
      } catch (cause) {
        clearTimeout(timer)
        this.#pending.delete(id)
        reject(cause)
      }
    })
  }

  #write(message: Message): void {
    if (this.#closed) throw new CdpPipeError('CDP_PIPE_CLOSED')
    const bytes = Buffer.from(JSON.stringify(message) + '\0')
    if (bytes.length > MAX_MESSAGE_BYTES + 1) throw new CdpPipeError('CDP_PIPE_CAPACITY')
    if (this.#writable.writableLength + bytes.length > MAX_QUEUED_BYTES) {
      this.#fail('CDP_PIPE_CAPACITY')
      throw new CdpPipeError('CDP_PIPE_CAPACITY')
    }
    if (!this.#writable.write(bytes)) {
      this.#backpressured = true
      for (const client of this.#clients) client.socket.pause()
    }
  }

  #read(chunk: Buffer): void {
    if (this.#closed) return
    this.#buffer = Buffer.concat([this.#buffer, chunk])
    try {
      while (true) {
        const separator = this.#buffer.indexOf(0)
        if (separator === -1) {
          if (this.#buffer.length > MAX_MESSAGE_BYTES) throw new CdpPipeError('CDP_PIPE_CAPACITY')
          return
        }
        if (separator > MAX_MESSAGE_BYTES) throw new CdpPipeError('CDP_PIPE_CAPACITY')
        const frame = this.#buffer.subarray(0, separator)
        this.#buffer = this.#buffer.subarray(separator + 1)
        if (frame.length > 0) this.#route(parseMessage(frame.toString()))
      }
    } catch {
      this.#fail('CDP_PIPE_INVALID_MESSAGE')
    }
  }

  #route(message: Message): void {
    if (message.id !== undefined) {
      if (!Number.isSafeInteger(message.id)) throw new CdpPipeError('CDP_PIPE_INVALID_MESSAGE')
      const pending = this.#pending.get(message.id as number)
      if (pending === undefined) return // The owning client may already have disconnected.
      this.#pending.delete(message.id as number)
      clearTimeout(pending.timer)
      if (pending.client === undefined) {
        if (message.error !== undefined)
          pending.reject?.(new CdpPipeError('CDP_PIPE_COMMAND_FAILED'))
        else pending.resolve?.(isRecord(message.result) ? message.result : {})
      } else {
        const client = pending.client
        client.pendingIds.delete(pending.originalId!)
        if (isRecord(message.result) && typeof message.result.sessionId === 'string') {
          this.#owners.set(message.result.sessionId, client)
        }
        this.#send(client, { ...message, id: pending.originalId })
      }
      return
    }
    if (typeof message.sessionId !== 'string') return
    const client = this.#owners.get(message.sessionId)
    if (client === undefined) return
    const childId = isRecord(message.params) ? message.params.sessionId : undefined
    if (message.method === 'Target.attachedToTarget' && typeof childId === 'string') {
      this.#owners.set(childId, client)
    }
    this.#send(client, message)
    if (message.method === 'Target.detachedFromTarget' && typeof childId === 'string') {
      this.#owners.delete(childId)
    }
  }

  #send(client: Client, message: Message): void {
    if (client.closed) return
    const output = { ...message }
    if (output.sessionId === client.browserId) delete output.sessionId
    const text = JSON.stringify(output)
    if (client.socket.bufferedAmount + Buffer.byteLength(text) > MAX_QUEUED_BYTES) {
      this.#drop(client)
      return
    }
    client.socket.send(text, (error) => {
      if (error) this.#drop(client)
    })
  }
}

function isRecord(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMessage(text: string): Message {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) throw new CdpPipeError('CDP_PIPE_INVALID_MESSAGE')
  return value
}
