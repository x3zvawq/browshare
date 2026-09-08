import type { FastifyReply, FastifyRequest } from 'fastify'

import type { BackendConfiguration } from './configuration.js'
import { requirePortalSession } from './http-session.js'
import type { AuthenticationPort, AuthenticatedPortalSession } from './services/authentication.js'
import type { AuthorizationPort } from './services/authorization.js'

export async function requirePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  configuration: BackendConfiguration,
  services: {
    readonly authentication: AuthenticationPort
    readonly authorization: AuthorizationPort
  },
  permission: string,
): Promise<AuthenticatedPortalSession> {
  const { session } = await requirePortalSession(
    request,
    reply,
    configuration,
    services.authentication,
  )
  await services.authorization.requirePermission(session.user.id, permission)
  return session
}
