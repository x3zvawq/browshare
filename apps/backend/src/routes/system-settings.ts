import {
  SessionMediaSettingsSchema,
  type SessionMediaSettings,
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  RegistrationSettingsSchema,
  SessionTransferSettingsSchema,
  ViewerFocusPolicySchema,
  type ViewerFocusPolicy,
  type SessionTransferSettings,
  type RegistrationSettings,
} from '@browshare/contracts'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { SystemSettingsService } from '../services/system-settings.js'

export function registerSystemSettingsRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    settings: Pick<
      SystemSettingsService,
      | 'getRegistration'
      | 'saveRegistration'
      | 'getTransfers'
      | 'saveTransfers'
      | 'getViewerFocus'
      | 'saveViewerFocus'
      | 'getMedia'
      | 'saveMedia'
    >
  },
) {
  const path = `/api/${BROWSHARE_API_VERSION}/settings/registration`
  const response = {
    200: RegistrationSettingsSchema,
    400: ApiErrorEnvelopeSchema,
    401: ApiErrorEnvelopeSchema,
    403: ApiErrorEnvelopeSchema,
  }
  app.get(
    path,
    { schema: { tags: ['System Settings'], operationId: 'getRegistrationSettings', response } },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'system.manage')
      return services.settings.getRegistration()
    },
  )
  app.put<{ Body: RegistrationSettings }>(
    path,
    {
      schema: {
        tags: ['System Settings'],
        operationId: 'saveRegistrationSettings',
        body: RegistrationSettingsSchema,
        response,
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'system.manage',
      )
      return services.settings.saveRegistration(request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
  const transfersPath = `/api/${BROWSHARE_API_VERSION}/settings/transfers`
  const transferResponse = { ...response, 200: SessionTransferSettingsSchema }
  app.get(
    transfersPath,
    {
      schema: {
        tags: ['System Settings'],
        operationId: 'getSessionTransferSettings',
        response: transferResponse,
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'system.manage')
      return services.settings.getTransfers()
    },
  )
  app.put<{ Body: SessionTransferSettings }>(
    transfersPath,
    {
      schema: {
        tags: ['System Settings'],
        operationId: 'saveSessionTransferSettings',
        body: SessionTransferSettingsSchema,
        response: transferResponse,
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'system.manage',
      )
      return services.settings.saveTransfers(request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
  const focusPath = `/api/${BROWSHARE_API_VERSION}/settings/viewer-focus`
  const mediaPath = `/api/${BROWSHARE_API_VERSION}/settings/media`
  const mediaResponse = { ...response, 200: SessionMediaSettingsSchema }
  app.get(
    mediaPath,
    {
      schema: {
        tags: ['System Settings'],
        operationId: 'getSessionMediaSettings',
        response: mediaResponse,
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'system.manage')
      return services.settings.getMedia()
    },
  )
  app.put<{ Body: SessionMediaSettings }>(
    mediaPath,
    {
      schema: {
        tags: ['System Settings'],
        operationId: 'saveSessionMediaSettings',
        body: SessionMediaSettingsSchema,
        response: mediaResponse,
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'system.manage',
      )
      return services.settings.saveMedia(request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
  const focusResponse = { ...response, 200: ViewerFocusPolicySchema }
  app.get(
    focusPath,
    {
      schema: {
        tags: ['System Settings'],
        operationId: 'getViewerFocusPolicy',
        response: focusResponse,
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'system.manage')
      return services.settings.getViewerFocus()
    },
  )
  app.put<{ Body: ViewerFocusPolicy }>(
    focusPath,
    {
      schema: {
        tags: ['System Settings'],
        operationId: 'saveViewerFocusPolicy',
        body: ViewerFocusPolicySchema,
        response: focusResponse,
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'system.manage',
      )
      return services.settings.saveViewerFocus(request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
}
