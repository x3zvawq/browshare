import Type from 'typebox'
import {
  ApiErrorEnvelopeSchema,
  DownloadClaimSchema,
  DownloadListQuerySchema,
  DownloadListResponseSchema,
  type DownloadListQuery,
} from '@browshare/contracts'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { SessionDownloadService } from '../services/session-downloads.js'
import { requirePortalSession } from '../http-session.js'

export function registerSessionDownloadRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    downloads: Pick<SessionDownloadService, 'list' | 'prepare'>
  },
): void {
  const root = '/api/v1/sessions/:id/downloads'
  const errors = {
    400: ApiErrorEnvelopeSchema,
    401: ApiErrorEnvelopeSchema,
    403: ApiErrorEnvelopeSchema,
    404: ApiErrorEnvelopeSchema,
    409: ApiErrorEnvelopeSchema,
    503: ApiErrorEnvelopeSchema,
  }
  app.get<{ Params: { id: string }; Querystring: DownloadListQuery }>(
    root,
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'listSessionDownloads',
        params: Type.Object(
          { id: Type.String({ format: 'uuid' }) },
          { additionalProperties: false },
        ),
        querystring: DownloadListQuerySchema,
        response: { 200: DownloadListResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { session } = await requirePortalSession(
        request,
        reply,
        configuration,
        services.authentication,
      )
      return services.downloads.list(session.user.id, request.params.id, request.query)
    },
  )
  app.post<{ Params: { id: string; downloadId: string } }>(
    root + '/:downloadId/claim',
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'prepareSessionDownload',
        params: Type.Object(
          { id: Type.String({ format: 'uuid' }), downloadId: Type.String({ format: 'uuid' }) },
          { additionalProperties: false },
        ),
        response: { 200: DownloadClaimSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { session } = await requirePortalSession(
        request,
        reply,
        configuration,
        services.authentication,
      )
      return services.downloads.prepare(
        session.user.id,
        session.sessionId,
        request.params.id,
        request.params.downloadId,
        request.id,
      )
    },
  )
}
