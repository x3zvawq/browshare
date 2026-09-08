import { BrowShareError } from '@browshare/common'
import {
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  CreateWorkerCredentialRotationRequestSchema,
  IssuedWorkerCredentialRotationResponseSchema,
  RetireWorkerRequestSchema,
  RetireWorkerResponseSchema,
  RevokeWorkerCredentialRequestSchema,
  RotateWorkerCredentialRequestSchema,
  RotateWorkerCredentialResponseSchema,
  SetWorkerStateRequestSchema,
  UpdateWorkerCapacityRequestSchema,
  WorkerCredentialListResponseSchema,
  WorkerCredentialResponseSchema,
  WorkerCredentialRotationListResponseSchema,
  WorkerCredentialRotationResponseSchema,
  WorkerDiagnosticProbeResponseSchema,
  WorkerListQuerySchema,
  WorkerListResponseSchema,
  WorkerResponseSchema,
  WorkerStateResponseSchema,
  type CreateWorkerCredentialRotationRequest,
  type RetireWorkerRequest,
  type RevokeWorkerCredentialRequest,
  type RotateWorkerCredentialRequest,
  type SetWorkerStateRequest,
  type UpdateWorkerCapacityRequest,
  type WorkerListQuery,
  type WorkerResponse,
} from '@browshare/contracts'
import Type from 'typebox'

import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import {
  WorkerCommandError,
  type WorkerControlCommandPort,
} from '../services/worker-control-server.js'
import {
  readWorkerCredentialRotationBearer,
  type WorkerCredentialPort,
} from '../services/worker-credentials.js'
import type { WorkerPort } from '../services/workers.js'

const WorkerIdParamsSchema = Type.Object(
  { workerId: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
)

const WorkerCredentialIdParamsSchema = Type.Object(
  {
    workerId: Type.String({ format: 'uuid' }),
    credentialId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
)

const WorkerCredentialRotationIdParamsSchema = Type.Object(
  {
    workerId: Type.String({ format: 'uuid' }),
    rotationId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
)

const WorkerCredentialRotationHeadersSchema = Type.Object(
  { authorization: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: true },
)

export function registerWorkerRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    readonly authentication: AuthenticationPort
    readonly authorization: AuthorizationPort
    readonly workerControl: WorkerControlCommandPort
    readonly workerCredentials: WorkerCredentialPort
    readonly workers: WorkerPort
  },
): void {
  app.post<{
    Body: RotateWorkerCredentialRequest
    Headers: { authorization: string }
  }>(
    `/api/${BROWSHARE_API_VERSION}/workers/credential-rotation`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'rotateWorkerCredential',
        headers: WorkerCredentialRotationHeadersSchema,
        body: RotateWorkerCredentialRequestSchema,
        response: {
          201: RotateWorkerCredentialResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const token = readWorkerCredentialRotationBearer(request.headers.authorization)
      const credential = await services.workerCredentials.rotate(token, request.body, {
        requestId: request.id,
      })
      reply.status(201)
      return credential
    },
  )

  app.get<{ Querystring: WorkerListQuery }>(
    `/api/${BROWSHARE_API_VERSION}/workers`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'listWorkers',
        querystring: WorkerListQuerySchema,
        response: {
          200: WorkerListResponseSchema,
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
        'worker.read',
      )
      const [result, canReadProfiles] = await Promise.all([
        services.workers.list(request.query),
        services.authorization.hasPermission(session.user.id, 'profile.read'),
      ])
      return {
        ...result,
        items: result.items.map((worker) => redactCleanupIdentities(worker, canReadProfiles)),
      }
    },
  )

  app.get<{ Params: { workerId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/workers/:workerId`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'getWorker',
        params: WorkerIdParamsSchema,
        response: {
          200: WorkerResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'worker.read',
      )
      const [result, canReadProfiles] = await Promise.all([
        services.workers.get(request.params.workerId),
        services.authorization.hasPermission(session.user.id, 'profile.read'),
      ])
      return redactCleanupIdentities(result, canReadProfiles)
    },
  )

  app.get<{ Params: { workerId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/workers/:workerId/credentials`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'listWorkerCredentials',
        params: WorkerIdParamsSchema,
        response: {
          200: WorkerCredentialListResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'worker.read')
      return services.workerCredentials.listCredentials(request.params.workerId)
    },
  )

  app.get<{ Params: { workerId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/workers/:workerId/credential-rotations`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'listWorkerCredentialRotations',
        params: WorkerIdParamsSchema,
        response: {
          200: WorkerCredentialRotationListResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'worker.read')
      return services.workerCredentials.listRotations(request.params.workerId)
    },
  )

  app.post<{
    Params: { workerId: string }
    Body: CreateWorkerCredentialRotationRequest
  }>(
    `/api/${BROWSHARE_API_VERSION}/workers/:workerId/credential-rotations`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'createWorkerCredentialRotation',
        params: WorkerIdParamsSchema,
        body: CreateWorkerCredentialRotationRequestSchema,
        response: {
          201: IssuedWorkerCredentialRotationResponseSchema,
          400: ApiErrorEnvelopeSchema,
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
      const rotation = await services.workerCredentials.createRotation(
        request.params.workerId,
        request.body,
        { actorUserId: session.user.id, requestId: request.id },
      )
      reply.status(201)
      return rotation
    },
  )

  app.post<{ Params: { workerId: string; rotationId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/workers/:workerId/credential-rotations/:rotationId/revoke`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'revokeWorkerCredentialRotation',
        params: WorkerCredentialRotationIdParamsSchema,
        response: {
          200: WorkerCredentialRotationResponseSchema,
          400: ApiErrorEnvelopeSchema,
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
      return services.workerCredentials.revokeRotation(
        request.params.workerId,
        request.params.rotationId,
        { actorUserId: session.user.id, requestId: request.id },
      )
    },
  )

  app.post<{
    Params: { workerId: string; credentialId: string }
    Body: RevokeWorkerCredentialRequest
  }>(
    `/api/${BROWSHARE_API_VERSION}/workers/:workerId/credentials/:credentialId/revoke`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'revokeWorkerCredential',
        params: WorkerCredentialIdParamsSchema,
        body: RevokeWorkerCredentialRequestSchema,
        response: {
          200: WorkerCredentialResponseSchema,
          400: ApiErrorEnvelopeSchema,
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
      return services.workerCredentials.revokeCredential(
        request.params.workerId,
        request.params.credentialId,
        request.body.reason,
        { actorUserId: session.user.id, requestId: request.id },
      )
    },
  )

  app.post<{ Params: { workerId: string }; Body: RetireWorkerRequest }>(
    `/api/${BROWSHARE_API_VERSION}/workers/:workerId/retire`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'retireWorker',
        params: WorkerIdParamsSchema,
        body: RetireWorkerRequestSchema,
        response: {
          200: RetireWorkerResponseSchema,
          400: ApiErrorEnvelopeSchema,
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
      return services.workerCredentials.retire(request.params.workerId, request.body.expectedName, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )

  app.patch<{ Params: { workerId: string }; Body: UpdateWorkerCapacityRequest }>(
    `/api/${BROWSHARE_API_VERSION}/workers/:workerId`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'updateWorkerCapacity',
        params: WorkerIdParamsSchema,
        body: UpdateWorkerCapacityRequestSchema,
        response: {
          200: WorkerResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
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
      const result = await services.workers.updateCapacity(request.params.workerId, request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
      return redactCleanupIdentities(
        result,
        await services.authorization.hasPermission(session.user.id, 'profile.read'),
      )
    },
  )

  app.get<{ Params: { workerId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/workers/:workerId/state`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'getWorkerState',
        params: WorkerIdParamsSchema,
        response: {
          200: WorkerStateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'worker.read')
      return services.workers.getState(request.params.workerId)
    },
  )

  app.put<{ Params: { workerId: string }; Body: SetWorkerStateRequest }>(
    `/api/${BROWSHARE_API_VERSION}/workers/:workerId/state`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'setWorkerState',
        params: WorkerIdParamsSchema,
        body: SetWorkerStateRequestSchema,
        response: {
          200: WorkerStateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
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
      return services.workers.setState(request.params.workerId, request.body.state, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )

  app.post<{ Params: { workerId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/workers/:workerId/diagnostics/probe`,
    {
      schema: {
        tags: ['Workers'],
        operationId: 'runWorkerDiagnosticProbe',
        params: WorkerIdParamsSchema,
        response: {
          200: WorkerDiagnosticProbeResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
          502: ApiErrorEnvelopeSchema,
          504: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'worker.manage')
      try {
        const result = await services.workerControl.runDiagnosticProbe(request.params.workerId)
        if (result.payload.outcome !== 'SUCCEEDED' || result.payload.report === null) {
          throw new WorkerCommandError(
            'WORKER_COMMAND_FAILED',
            'The Worker diagnostic command did not return a capability report.',
          )
        }
        return {
          commandId: result.correlationId,
          workerId: result.payload.workerId,
          completedAt: result.payload.completedAt,
          report: result.payload.report,
        }
      } catch (cause) {
        throw mapWorkerCommandError(cause)
      }
    },
  )
}

function mapWorkerCommandError(cause: unknown): unknown {
  if (!(cause instanceof WorkerCommandError)) return cause
  if (cause.code === 'WORKER_COMMAND_TIMEOUT') {
    return new BrowShareError({
      code: 'WORKER_COMMAND_TIMEOUT',
      message: cause.message,
      statusCode: 504,
      cause,
    })
  }
  if (cause.code === 'WORKER_COMMAND_FAILED') {
    return new BrowShareError({
      code: 'WORKER_COMMAND_FAILED',
      message: cause.message,
      statusCode: 502,
      cause,
    })
  }
  return new BrowShareError({
    code: 'WORKER_UNAVAILABLE',
    message: cause.message,
    statusCode: 409,
    cause,
  })
}

/** Worker diagnostics remain useful without exposing Profile/Session identities. */
export function redactCleanupIdentities(
  worker: WorkerResponse,
  canReadProfiles: boolean,
): WorkerResponse {
  if (canReadProfiles) return worker
  return {
    ...worker,
    cleanupFailures: worker.cleanupFailures.map((fact) => ({
      ...fact,
      profileId: null,
      runtimeId: null,
      sessionId: null,
    })),
  }
}
