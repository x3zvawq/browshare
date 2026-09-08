import type { ApiErrorEnvelope } from './types.js'

export class ApiFailure extends Error {
  readonly code: string
  readonly requestId: string | undefined
  readonly status: number | undefined
  readonly details: unknown

  constructor(options: {
    readonly code: string
    readonly message: string
    readonly requestId?: string
    readonly status?: number
    readonly details?: unknown
  }) {
    super(options.message)
    this.name = 'ApiFailure'
    this.code = options.code
    this.requestId = options.requestId
    this.status = options.status
    this.details = options.details
  }
}

export function apiFailure(error: unknown, response: Response): ApiFailure {
  if (isApiErrorEnvelope(error)) {
    return new ApiFailure({
      code: error.error.code,
      message: error.error.message,
      requestId: error.error.requestId,
      status: response.status,
      details: error.error.details,
    })
  }
  return new ApiFailure({
    code: 'UNEXPECTED_RESPONSE',
    message: `The server returned an unexpected response (${response.status}).`,
    status: response.status,
    ...(response.headers.get('x-request-id')
      ? { requestId: response.headers.get('x-request-id')! }
      : {}),
  })
}

export function networkFailure(error: unknown): ApiFailure {
  if (error instanceof ApiFailure) return error
  return new ApiFailure({
    code: 'NETWORK_ERROR',
    message: error instanceof Error ? error.message : 'The server could not be reached.',
  })
}

function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error = value.error
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string' &&
    'requestId' in error &&
    typeof error.requestId === 'string'
  )
}
