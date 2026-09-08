import {
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  RegisterWorkerRequestSchema,
  RegisterWorkerResponseSchema,
  type RegisterWorkerRequest,
} from '@browshare/contracts'
import Type from 'typebox'

import type { BackendApp } from '../app.js'
import {
  readWorkerEnrollmentBearer,
  type WorkerRegistrationPort,
} from '../services/worker-registration.js'

const WorkerRegistrationHeadersSchema = Type.Object(
  {
    authorization: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: true },
)

export function registerWorkerRegistrationRoutes(
  app: BackendApp,
  workerRegistration: WorkerRegistrationPort,
): void {
  app.post<{ Body: RegisterWorkerRequest; Headers: { authorization: string } }>(
    `/api/${BROWSHARE_API_VERSION}/workers/enroll`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'registerWorker',
        headers: WorkerRegistrationHeadersSchema,
        body: RegisterWorkerRequestSchema,
        response: {
          201: RegisterWorkerResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const token = readWorkerEnrollmentBearer(request.headers.authorization)
      const registration = await workerRegistration.register(token, request.body, {
        requestId: request.id,
      })
      reply.status(201)
      return registration
    },
  )
}
