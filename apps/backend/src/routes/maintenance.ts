import {
  BROWSHARE_API_VERSION,
  ApiErrorEnvelopeSchema,
  MaintenanceProfileListQuerySchema,
  MaintenanceProfileListResponseSchema,
  MaintenanceProfileSchema,
  MaintenanceSessionCreateRequestSchema,
  TabSessionSchema,
  type MaintenanceProfileListQuery,
  type MaintenanceSessionCreateRequest,
} from '@browshare/contracts'
import Type from 'typebox'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { MaintenanceProfileService } from '../services/maintenance-profiles.js'
import type { SessionCreationService } from '../services/session-creation.js'

export function registerMaintenanceRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    maintenanceProfiles: Pick<MaintenanceProfileService, 'list' | 'get'>
    sessionCreation: Pick<SessionCreationService, 'createMaintenance'>
  },
): void {
  const root = `/api/${BROWSHARE_API_VERSION}`
  const errors = {
    400: ApiErrorEnvelopeSchema,
    401: ApiErrorEnvelopeSchema,
    403: ApiErrorEnvelopeSchema,
    404: ApiErrorEnvelopeSchema,
    409: ApiErrorEnvelopeSchema,
    503: ApiErrorEnvelopeSchema,
  }
  const params = Type.Object(
    { id: Type.String({ format: 'uuid' }) },
    { additionalProperties: false },
  )
  app.get<{ Querystring: MaintenanceProfileListQuery }>(
    root + '/maintenance/profiles',
    {
      schema: {
        tags: ['Maintenance'],
        operationId: 'listMaintenanceProfiles',
        querystring: MaintenanceProfileListQuerySchema,
        response: { 200: MaintenanceProfileListResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'profile.maintain',
      )
      return services.maintenanceProfiles.list(auth.user.id, request.query)
    },
  )
  app.get<{ Params: { id: string } }>(
    root + '/profiles/:id/maintenance',
    {
      schema: {
        tags: ['Maintenance'],
        operationId: 'getMaintenanceProfile',
        params,
        response: { 200: MaintenanceProfileSchema, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'profile.maintain',
      )
      return services.maintenanceProfiles.get(auth.user.id, request.params.id)
    },
  )
  app.post<{ Params: { id: string }; Body: MaintenanceSessionCreateRequest }>(
    root + '/profiles/:id/maintenance',
    {
      schema: {
        tags: ['Maintenance'],
        operationId: 'createMaintenanceSession',
        params,
        body: MaintenanceSessionCreateRequestSchema,
        response: { 202: TabSessionSchema, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'profile.maintain',
      )
      return reply
        .status(202)
        .send(
          await services.sessionCreation.createMaintenance(
            auth.user.id,
            request.params.id,
            request.body,
            request.id,
          ),
        )
    },
  )
}
