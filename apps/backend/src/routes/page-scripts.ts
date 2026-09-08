import {
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  PageScriptStateSchema,
  PageScriptVersionSchema,
  PageScriptVersionSummarySchema,
  SavePageScriptDraftSchema,
  PageQuerySchema,
  PaginationMetaSchema,
  type SavePageScriptDraft,
  type PageQuery,
} from '@browshare/contracts'
import Type from 'typebox'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { PageScriptService } from '../services/page-scripts.js'

export function registerPageScriptRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    pageScripts: Pick<
      PageScriptService,
      'getState' | 'getVersion' | 'listVersions' | 'saveDraft' | 'publish' | 'disable'
    >
  },
) {
  const root = `/api/${BROWSHARE_API_VERSION}/profiles/:profileId/page-script`,
    tags = ['Page Scripts']
  const params = Type.Object(
    { profileId: Type.String({ format: 'uuid' }) },
    { additionalProperties: false },
  )
  const versionParams = Type.Object(
    { ...params.properties, id: Type.String({ format: 'uuid' }) },
    { additionalProperties: false },
  )
  const errors = {
    400: ApiErrorEnvelopeSchema,
    401: ApiErrorEnvelopeSchema,
    403: ApiErrorEnvelopeSchema,
    404: ApiErrorEnvelopeSchema,
    409: ApiErrorEnvelopeSchema,
  }
  app.get<{ Params: { profileId: string } }>(
    root,
    {
      schema: {
        tags,
        operationId: 'getPageScriptState',
        params,
        response: { 200: PageScriptStateSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.pageScripts.getState(request.params.profileId)
    },
  )
  app.get<{ Params: { profileId: string }; Querystring: PageQuery }>(
    root + '/versions',
    {
      schema: {
        tags,
        operationId: 'listPageScriptVersions',
        params,
        querystring: PageQuerySchema,
        response: {
          200: Type.Object(
            { items: Type.Array(PageScriptVersionSummarySchema), meta: PaginationMetaSchema },
            { additionalProperties: false },
          ),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.pageScripts.listVersions(request.params.profileId, request.query)
    },
  )
  app.get<{ Params: { profileId: string; id: string } }>(
    root + '/versions/:id',
    {
      schema: {
        tags,
        operationId: 'getPageScriptVersion',
        params: versionParams,
        response: { 200: PageScriptVersionSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.pageScripts.getVersion(request.params.profileId, request.params.id)
    },
  )
  app.put<{ Params: { profileId: string }; Body: SavePageScriptDraft }>(
    root + '/draft',
    {
      schema: {
        tags,
        operationId: 'savePageScriptDraft',
        params,
        body: SavePageScriptDraftSchema,
        response: { 200: PageScriptVersionSchema, ...errors },
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
      return services.pageScripts.saveDraft(request.params.profileId, request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
  for (const action of ['publish', 'disable'] as const)
    app.post<{ Params: { profileId: string; id: string } }>(
      root + '/versions/:id/' + action,
      {
        schema: {
          tags,
          operationId:
            action === 'publish' ? 'publishPageScriptVersion' : 'disablePageScriptVersion',
          params: versionParams,
          response: { 200: PageScriptVersionSchema, ...errors },
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
        return services.pageScripts[action](request.params.profileId, request.params.id, {
          actorUserId: session.user.id,
          requestId: request.id,
        })
      },
    )
}
