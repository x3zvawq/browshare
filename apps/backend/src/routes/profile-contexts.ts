import {
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  ProfileContextSchema,
  SaveProfileContextSchema,
  type SaveProfileContext,
} from '@browshare/contracts'
import Type from 'typebox'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { ProfileContextService } from '../services/profile-contexts.js'

export function registerProfileContextRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    profileContexts: Pick<ProfileContextService, 'get' | 'save'>
  },
) {
  const root = `/api/${BROWSHARE_API_VERSION}/profiles/:profileId/contexts/:userId`
  const params = Type.Object(
    { profileId: Type.String({ format: 'uuid' }), userId: Type.String({ format: 'uuid' }) },
    { additionalProperties: false },
  )
  const response = {
    200: ProfileContextSchema,
    400: ApiErrorEnvelopeSchema,
    401: ApiErrorEnvelopeSchema,
    403: ApiErrorEnvelopeSchema,
    404: ApiErrorEnvelopeSchema,
    409: ApiErrorEnvelopeSchema,
  }
  app.get<{ Params: { profileId: string; userId: string } }>(
    root,
    {
      schema: { tags: ['Page Scripts'], operationId: 'getProfileContext', params, response },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.manage')
      return services.profileContexts.get(request.params.profileId, request.params.userId)
    },
  )
  app.put<{ Params: { profileId: string; userId: string }; Body: SaveProfileContext }>(
    root,
    {
      schema: {
        tags: ['Page Scripts'],
        operationId: 'saveProfileContext',
        params,
        body: SaveProfileContextSchema,
        response,
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'profile.manage',
      )
      return services.profileContexts.save(
        request.params.profileId,
        request.params.userId,
        request.body,
        { actorUserId: session.user.id, requestId: request.id },
      )
    },
  )
}
