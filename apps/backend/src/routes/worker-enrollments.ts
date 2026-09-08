import {
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  CreateWorkerEnrollmentRequestSchema,
  IssuedWorkerEnrollmentResponseSchema,
  WorkerEnrollmentListQuerySchema,
  WorkerEnrollmentListResponseSchema,
  WorkerEnrollmentResponseSchema,
  type CreateWorkerEnrollmentRequest,
  type WorkerEnrollmentListQuery,
} from '@browshare/contracts'
import Type from 'typebox'

import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { WorkerEnrollmentPort } from '../services/worker-enrollments.js'

const EnrollmentIdParamsSchema = Type.Object(
  { enrollmentId: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
)

export function registerWorkerEnrollmentRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    readonly authentication: AuthenticationPort
    readonly authorization: AuthorizationPort
    readonly workerEnrollments: WorkerEnrollmentPort
  },
): void {
  app.get<{ Querystring: WorkerEnrollmentListQuery }>(
    `/api/${BROWSHARE_API_VERSION}/workers/enrollments`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'listWorkerEnrollments',
        querystring: WorkerEnrollmentListQuerySchema,
        response: {
          200: WorkerEnrollmentListResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'worker.read')
      return services.workerEnrollments.list(request.query)
    },
  )

  app.post<{ Body: CreateWorkerEnrollmentRequest }>(
    `/api/${BROWSHARE_API_VERSION}/workers/enrollments`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'createWorkerEnrollment',
        body: CreateWorkerEnrollmentRequestSchema,
        response: {
          201: IssuedWorkerEnrollmentResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'worker.manage',
      )
      const issued = await services.workerEnrollments.create(request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
      reply.status(201)
      return issued
    },
  )

  app.post<{ Params: { enrollmentId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/workers/enrollments/:enrollmentId/revoke`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'revokeWorkerEnrollment',
        params: EnrollmentIdParamsSchema,
        response: {
          200: WorkerEnrollmentResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'worker.manage',
      )
      return services.workerEnrollments.revoke(request.params.enrollmentId, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
}
