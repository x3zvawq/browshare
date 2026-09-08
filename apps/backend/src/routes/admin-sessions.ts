import {
  AdminTabSessionSchema,
  AdminTabSessionListQuerySchema,
  AdminTabSessionListResponseSchema,
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  type AdminTabSessionListQuery,
} from '@browshare/contracts'
import Type from 'typebox'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { AdminSessionService } from '../services/admin-sessions.js'

export function registerAdminSessionRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    adminSessions: Pick<AdminSessionService, 'list' | 'get' | 'close'>
  },
): void {
  const root = `/api/${BROWSHARE_API_VERSION}/admin/sessions`
  const errors = {
    400: ApiErrorEnvelopeSchema,
    401: ApiErrorEnvelopeSchema,
    403: ApiErrorEnvelopeSchema,
    404: ApiErrorEnvelopeSchema,
  }
  const params = Type.Object(
    { id: Type.String({ format: 'uuid' }) },
    { additionalProperties: false },
  )
  app.get<{ Querystring: AdminTabSessionListQuery }>(
    root,
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'listAdminTabSessions',
        querystring: AdminTabSessionListQuerySchema,
        response: { 200: AdminTabSessionListResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      reply.header('cache-control', 'no-store')
      return services.adminSessions.list(request.query)
    },
  )
  app.get<{ Params: { id: string } }>(
    root + '/:id',
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'getAdminTabSession',
        params,
        response: { 200: AdminTabSessionSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      reply.header('cache-control', 'no-store')
      return services.adminSessions.get(request.params.id)
    },
  )
  app.post<{ Params: { id: string } }>(
    root + '/:id/close',
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'terminateAdminTabSession',
        params,
        response: { 202: AdminTabSessionSchema, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'session.terminate_any',
      )
      reply.header('cache-control', 'no-store')
      return reply.status(202).send(
        await services.adminSessions.close(request.params.id, {
          actorUserId: auth.user.id,
          requestId: request.id,
        }),
      )
    },
  )
}
