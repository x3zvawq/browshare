import {
  ApiErrorEnvelopeSchema,
  DiagnosticBundleQuerySchema,
  DiagnosticBundleSchema,
  type DiagnosticBundleQuery,
} from '@browshare/contracts'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { DiagnosticBundleService } from '../services/diagnostic-bundle.js'
export function registerDiagnosticBundleRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    diagnostics: Pick<DiagnosticBundleService, 'collect'>
  },
): void {
  app.get<{ Querystring: DiagnosticBundleQuery }>(
    '/api/v1/admin/diagnostics',
    {
      schema: {
        tags: ['Administration'],
        operationId: 'getDiagnosticBundle',
        querystring: DiagnosticBundleQuerySchema,
        response: {
          200: DiagnosticBundleSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store')
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'system.manage',
      )
      for (const permission of ['worker.read', 'profile.read', 'audit.read'])
        await services.authorization.requirePermission(session.user.id, permission)
      return services.diagnostics.collect(request.query, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
}
