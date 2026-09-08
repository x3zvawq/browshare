import {
  ApiErrorEnvelopeSchema,
  BootstrapCompleteSchema,
  BootstrapRequestSchema,
  BootstrapStatusSchema,
  BROWSHARE_API_VERSION,
  type BootstrapRequest,
} from '@browshare/contracts'
import type { BackendApp } from '../app.js'
import type { BootstrapPort } from '../services/bootstrap-access.js'

export function registerBootstrapRoutes(app: BackendApp, bootstrap: BootstrapPort): void {
  const path = `/api/${BROWSHARE_API_VERSION}/bootstrap`
  app.get(
    path,
    {
      schema: {
        tags: ['Initialization'],
        operationId: 'getBootstrapStatus',
        response: { 200: BootstrapStatusSchema, 503: ApiErrorEnvelopeSchema },
      },
    },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store')
      return bootstrap.status()
    },
  )
  app.post<{ Body: BootstrapRequest }>(
    path,
    {
      schema: {
        tags: ['Initialization'],
        operationId: 'initializeBrowShare',
        body: BootstrapRequestSchema,
        response: {
          201: BootstrapCompleteSchema,
          400: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
          503: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store')
      const result = await bootstrap.initialize(request.body, request.id)
      return reply.status(201).send(result)
    },
  )
}
