import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { isPublicId } from '@browshare/common'
import { DownloadClaimTokenSchema } from '@browshare/contracts'
import { Value } from 'typebox/value'
import { DownloadAuthorizationError, type DownloadAuthorizer } from './download-authorization.js'
import {
  RetainedDownloadError,
  type DownloadLease,
  type WorkerRetainedDownloads,
} from './retained-downloads.js'

export interface WorkerDownloadListenerConfiguration {
  readonly host: string
  readonly port: number
  readonly endpoint: string
  readonly portalOrigin: string
}

/** Dedicated private listener, published only through the configured HTTPS file reverse proxy. */
export class WorkerDownloadServer {
  readonly #server
  readonly #requests = new Set<AbortController>()
  readonly #operations = new Set<Promise<void>>()
  #started = false

  constructor(
    private readonly configuration: WorkerDownloadListenerConfiguration,
    private readonly store: WorkerRetainedDownloads,
    private readonly authorizer: DownloadAuthorizer,
    private readonly onFailure: (code: string) => void,
  ) {
    this.#server = createServer(
      { requestTimeout: 5000, headersTimeout: 5000 },
      (request, response) => {
        const operation = this.#handle(request, response)
        this.#operations.add(operation)
        void operation.finally(() => this.#operations.delete(operation))
      },
    )
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('Download listener already started')
    await new Promise<void>((resolve, reject) => {
      this.#server.once('error', reject)
      this.#server.listen(this.configuration.port, this.configuration.host, () => {
        this.#server.off('error', reject)
        resolve()
      })
    })
    this.#started = true
  }
  get port(): number {
    const address = this.#server.address()
    if (!address || typeof address === 'string') throw new Error('Download listener is not running')
    return address.port
  }
  async close(): Promise<void> {
    for (const request of this.#requests) request.abort()
    if (this.#started) {
      const closed = new Promise<void>((resolve) => this.#server.close(() => resolve()))
      this.#server.closeAllConnections()
      await closed
      this.#started = false
    }
    await Promise.allSettled(this.#operations)
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const cancel = new AbortController()
    this.#requests.add(cancel)
    let claimId = '',
      lease: DownloadLease | undefined
    let checker: NodeJS.Timeout | undefined
    let bodyTimer: NodeJS.Timeout | undefined
    let completion: Promise<void> | undefined
    const abort = () => cancel.abort()
    const disconnect = () => {
      if (!response.writableFinished) cancel.abort()
    }
    const abortResponse = () => response.destroy()
    cancel.signal.addEventListener('abort', abortResponse, { once: true })
    response.once('close', disconnect)
    response.once('error', abort)
    response.setHeader('cache-control', 'no-store')
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('referrer-policy', 'no-referrer')
    try {
      if (
        request.method !== 'POST' ||
        request.url !== new URL(this.configuration.endpoint).pathname
      ) {
        response.writeHead(404).end()
        return
      }
      if (request.headers.origin !== this.configuration.portalOrigin)
        throw new DownloadAuthorizationError('AUTHORIZATION_FAILED')
      if (
        request.headers['content-type']?.split(';')[0]?.trim() !==
        'application/x-www-form-urlencoded'
      )
        throw new DownloadAuthorizationError('AUTHORIZATION_FAILED')
      bodyTimer = setTimeout(abort, 5000)
      bodyTimer.unref()
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += (chunk as Buffer).length
        if (size > 1024) throw new DownloadAuthorizationError('AUTHORIZATION_FAILED')
        chunks.push(chunk as Buffer)
      }
      clearTimeout(bodyTimer)
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
      const token = form.get('token')
      claimId = form.get('claimId') ?? ''
      if (
        !Value.Check(DownloadClaimTokenSchema, token) ||
        !isPublicId(claimId) ||
        form.size !== 2 ||
        form.getAll('token').length !== 1 ||
        form.getAll('claimId').length !== 1
      )
        throw new DownloadAuthorizationError('AUTHORIZATION_FAILED')
      const authorization = await this.authorizer.consume(token, cancel.signal)
      if (authorization.claimId !== claimId)
        throw new DownloadAuthorizationError('AUTHORIZATION_FAILED')
      lease = await this.store.acquire(authorization.downloadId, authorization.sessionId)
      lease.signal.addEventListener('abort', abort, { once: true })
      if (lease.signal.aborted || cancel.signal.aborted) throw new Error('Download interrupted')
      const activeLease = lease
      const recheck = async () => {
        try {
          const current = await this.authorizer.check(claimId, cancel.signal)
          if (
            current.claimId !== authorization.claimId ||
            current.downloadId !== authorization.downloadId ||
            current.sessionId !== authorization.sessionId
          )
            throw new Error('Authorization changed')
          if (!cancel.signal.aborted && !response.writableFinished) {
            checker = setTimeout(() => void recheck(), 1000)
            checker.unref()
          }
        } catch {
          if (!response.writableFinished) cancel.abort()
        }
      }
      checker = setTimeout(() => void recheck(), 1000)
      checker.unref()
      response.once('finish', () => {
        clearTimeout(checker)
        completion = activeLease.finish()
        // Persist errors must not become unhandled while pipeline settles.
        void completion.catch(() => this.onFailure('DOWNLOAD_COMPLETION_FAILED'))
      })
      response.setHeader('content-type', 'application/octet-stream')
      response.setHeader('content-length', lease.metadata.size)
      response.setHeader(
        'content-disposition',
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(
          lease.metadata.displayName.toWellFormed(),
        ).replace(
          /['()*]/g,
          (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
        )}`,
      )
      response.setHeader('x-accel-buffering', 'no')
      // A proxy can close upstream as soon as Content-Length is satisfied. Bound the
      // stream so response.end() does not wait for another filesystem read to discover EOF.
      const source = createReadStream(
        lease.path,
        lease.metadata.size === 0 ? undefined : { end: lease.metadata.size - 1 },
      )
      await pipeline(source, response, { signal: cancel.signal })
      await completion
    } catch (cause) {
      if (!response.headersSent && !response.destroyed && !cancel.signal.aborted) {
        const code =
          cause instanceof DownloadAuthorizationError || cause instanceof RetainedDownloadError
            ? cause.code
            : 'FILE_TRANSFER_FAILED'
        this.#error(response, claimId, code)
      }
    } finally {
      clearTimeout(bodyTimer)
      clearTimeout(checker)
      lease?.signal.removeEventListener('abort', abort)
      lease?.release()
      response.off('close', disconnect)
      response.off('error', abort)
      cancel.signal.removeEventListener('abort', abortResponse)
      cancel.abort()
      this.#requests.delete(cancel)
    }
  }

  #error(response: ServerResponse, claimId: string, code: string): void {
    const nonce = randomBytes(16).toString('base64')
    const payload = JSON.stringify({
      type: 'browshare.download.error',
      claimId: isPublicId(claimId) ? claimId : '',
      code,
    })
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.setHeader(
      'content-security-policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors ${this.configuration.portalOrigin}; base-uri 'none'`,
    )
    response.writeHead(code === 'WORKER_UNAVAILABLE' ? 503 : code === 'DOWNLOAD_BUSY' ? 409 : 403)
    response.end(
      `<!doctype html><meta charset="utf-8"><title>下载未完成</title><p>下载未完成，请返回下载列表重试。</p><script nonce="${nonce}">parent.postMessage(${payload},${JSON.stringify(this.configuration.portalOrigin)})</script>`,
    )
  }
}
