import { BROWSHARE_API_VERSION } from '@browshare/contracts'
import createClient from 'openapi-fetch'

import type { paths } from './generated.js'

export type { paths } from './generated.js'

export interface CreateApiClientOptions {
  readonly baseUrl?: string
  readonly fetch?: typeof globalThis.fetch
  readonly requestTimeoutMilliseconds?: number
}

export const DEFAULT_API_BASE_URL = `/api/${BROWSHARE_API_VERSION}`
export const DEFAULT_API_REQUEST_TIMEOUT_MILLISECONDS = 15_000

export function createApiClient(options: CreateApiClientOptions = {}) {
  const requestTimeoutMilliseconds =
    options.requestTimeoutMilliseconds ?? DEFAULT_API_REQUEST_TIMEOUT_MILLISECONDS
  if (!Number.isFinite(requestTimeoutMilliseconds) || requestTimeoutMilliseconds <= 0) {
    throw new RangeError('requestTimeoutMilliseconds must be a positive finite number')
  }

  return createClient<paths>({
    baseUrl: options.baseUrl ?? DEFAULT_API_BASE_URL,
    fetch: withRequestTimeout(options.fetch ?? globalThis.fetch, requestTimeoutMilliseconds),
    credentials: 'include',
  })
}

function withRequestTimeout(
  request: typeof globalThis.fetch,
  timeoutMilliseconds: number,
): typeof globalThis.fetch {
  return async (input, init) => {
    const controller = new AbortController()
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const abortFromCaller = () => controller.abort(callerSignal?.reason)

    if (callerSignal?.aborted) abortFromCaller()
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })

    const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds)
    try {
      return await request(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
      callerSignal?.removeEventListener('abort', abortFromCaller)
    }
  }
}
