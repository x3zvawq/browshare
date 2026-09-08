import { BrowShareError, safeErrorDiagnostic } from '@browshare/common'

import type { BackendApp } from '../app.js'

export function installErrorHandlers(app: BackendApp): void {
  app.setNotFoundHandler(async (request, reply) => {
    await reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource does not exist.',
        requestId: request.id,
      },
    })
  })

  app.setErrorHandler(async (error, request, reply) => {
    const failure = normalizeFailure(error)
    if (failure.statusCode >= 500) {
      request.log.error(
        { error: safeErrorDiagnostic(error), errorCode: failure.code },
        'Request failed',
      )
    } else {
      request.log.warn({ errorCode: failure.code }, 'Request rejected')
    }
    await reply.status(failure.statusCode).send({
      error: {
        code: failure.code,
        message: failure.message,
        requestId: request.id,
        ...(failure.details === undefined ? {} : { details: failure.details }),
      },
    })
  })
}

function normalizeFailure(error: unknown): BrowShareError {
  if (error instanceof BrowShareError) return error
  if (error instanceof Error && 'validation' in error && error.validation !== undefined) {
    return new BrowShareError({
      code: 'VALIDATION_FAILED',
      message: 'The request does not match the API contract.',
      statusCode: 400,
      details: error.validation,
      cause: error,
    })
  }
  return new BrowShareError({
    code: 'INTERNAL_ERROR',
    message: 'The server could not complete the request.',
    statusCode: 500,
    cause: error,
  })
}
