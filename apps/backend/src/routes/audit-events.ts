import {
  AuditEventSchema,
  AuditEventListQuerySchema,
  AuditEventListResponseSchema,
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  type AuditEventListQuery,
} from '@browshare/contracts'
import Type from 'typebox'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { AuditEventService } from '../services/audit-events.js'

export function registerAuditEventRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    auditEvents: Pick<AuditEventService, 'list' | 'get'>
  },
): void {
  const root = `/api/${BROWSHARE_API_VERSION}/audit-events`
  const errors = {
    400: ApiErrorEnvelopeSchema,
    401: ApiErrorEnvelopeSchema,
    403: ApiErrorEnvelopeSchema,
    404: ApiErrorEnvelopeSchema,
  }
  app.get<{ Querystring: AuditEventListQuery }>(
    root,
    {
      schema: {
        tags: ['Audit'],
        operationId: 'listAuditEvents',
        querystring: AuditEventListQuerySchema,
        response: { 200: AuditEventListResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'audit.read')
      reply.header('cache-control', 'no-store')
      return services.auditEvents.list(request.query)
    },
  )
  app.get<{ Params: { id: string } }>(
    root + '/:id',
    {
      schema: {
        tags: ['Audit'],
        operationId: 'getAuditEvent',
        params: Type.Object(
          { id: Type.String({ format: 'uuid' }) },
          { additionalProperties: false },
        ),
        response: { 200: AuditEventSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'audit.read')
      reply.header('cache-control', 'no-store')
      return services.auditEvents.get(request.params.id)
    },
  )
}
