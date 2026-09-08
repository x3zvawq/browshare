import { AdminOverviewSchema, ApiErrorEnvelopeSchema } from '@browshare/contracts'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePortalSession } from '../http-session.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { AdminOverviewService } from '../services/admin-overview.js'

export function registerAdminOverviewRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    overview: Pick<AdminOverviewService, 'get'>
  },
): void {
  app.get(
    '/api/v1/admin/overview',
    {
      schema: {
        tags: ['Administration'],
        operationId: 'getAdminOverview',
        response: {
          200: AdminOverviewSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const { session } = await requirePortalSession(
        request,
        reply,
        configuration,
        services.authentication,
      )
      const permissionCodes = await services.authorization.listUserPermissionCodes(session.user.id)
      reply.header('cache-control', 'no-store')
      return services.overview.get(permissionCodes)
    },
  )
}
