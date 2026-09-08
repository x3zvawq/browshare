import { request } from 'node:https'
import { DownloadAuthorizationSchema, type DownloadAuthorization } from '@browshare/contracts'
import { Value } from 'typebox/value'
import type { StoredWorkerIdentity } from './identity.js'

export interface DownloadAuthorizer {
  consume(token: string, signal: AbortSignal): Promise<DownloadAuthorization>
  check(claimId: string, signal: AbortSignal): Promise<DownloadAuthorization>
}
export class DownloadAuthorizationError extends Error {
  constructor(readonly code: 'AUTHORIZATION_FAILED' | 'WORKER_UNAVAILABLE') {
    super(code)
  }
}

/** Certificate-authenticated metadata requests only. No file content enters Backend. */
export class WorkerDownloadAuthorizer implements DownloadAuthorizer {
  constructor(
    private readonly identity: StoredWorkerIdentity,
    private readonly ca: string | undefined,
    private readonly instanceId: string,
    private readonly connected: () => boolean,
  ) {}

  consume(token: string, signal: AbortSignal): Promise<DownloadAuthorization> {
    return this.#call('consume', { token }, signal)
  }
  check(claimId: string, signal: AbortSignal): Promise<DownloadAuthorization> {
    return this.#call('check', { claimId }, signal)
  }
  #call(
    action: 'consume' | 'check',
    credential: { token: string } | { claimId: string },
    signal: AbortSignal,
  ): Promise<DownloadAuthorization> {
    if (!this.connected())
      return Promise.reject(new DownloadAuthorizationError('WORKER_UNAVAILABLE'))
    const url = new URL(this.identity.controlUrl)
    url.protocol = 'https:'
    url.pathname = `/internal/downloads/${action}`
    url.search = ''
    url.hash = ''
    const body = JSON.stringify({ instanceId: this.instanceId, ...credential })
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          cert: this.identity.certificatePem,
          key: this.identity.privateKeyPem,
          ...(this.ca === undefined ? {} : { ca: this.ca }),
          rejectUnauthorized: true,
          signal,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (response) => {
          const chunks: Buffer[] = []
          let length = 0
          response.on('data', (chunk: Buffer) => {
            length += chunk.length
            if (length > 4096) req.destroy(new Error('Invalid download authorization response'))
            else chunks.push(chunk)
          })
          response.on('error', () => reject(new DownloadAuthorizationError('WORKER_UNAVAILABLE')))
          response.on('end', () => {
            if (response.statusCode !== 200) {
              reject(
                new DownloadAuthorizationError(
                  response.statusCode === 403 ||
                    response.statusCode === 404 ||
                    response.statusCode === 409
                    ? 'AUTHORIZATION_FAILED'
                    : 'WORKER_UNAVAILABLE',
                ),
              )
              return
            }
            try {
              const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              if (!Value.Check(DownloadAuthorizationSchema, value))
                throw new Error('Invalid authorization')
              resolve(value)
            } catch {
              reject(new DownloadAuthorizationError('WORKER_UNAVAILABLE'))
            }
          })
        },
      )
      // A wall-clock deadline also bounds peers that keep trickling response bytes.
      const timer = setTimeout(
        () => req.destroy(new Error('Download authorization timed out')),
        2000,
      )
      timer.unref()
      req.once('close', () => clearTimeout(timer))
      req.on('error', () => reject(new DownloadAuthorizationError('WORKER_UNAVAILABLE')))
      req.end(body)
    })
  }
}
