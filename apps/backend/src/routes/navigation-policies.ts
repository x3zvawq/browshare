import {
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  NavigationPolicyStateSchema,
  NavigationPolicyVersionSchema,
  NavigationPolicyVersionSummarySchema,
  NavigationPolicyPreviewRequestSchema,
  NavigationPolicyPreviewSchema,
  SaveNavigationPolicyDraftSchema,
  PageQuerySchema,
  PaginationMetaSchema,
  type NavigationPolicyPreviewRequest,
  type SaveNavigationPolicyDraft,
  type PageQuery,
} from '@browshare/contracts'
import Type from 'typebox'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { NavigationPolicyService } from '../services/navigation-policies.js'

export function registerNavigationPolicyRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    navigationPolicies: Pick<
      NavigationPolicyService,
      'getState' | 'getVersion' | 'listVersions' | 'saveDraft' | 'preview' | 'publish' | 'disable'
    >
  },
) {
  const root = `/api/${BROWSHARE_API_VERSION}/profiles/:profileId/navigation-policy`,
    tags = ['Navigation Policies']
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
        operationId: 'getNavigationPolicyState',
        params,
        response: { 200: NavigationPolicyStateSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.navigationPolicies.getState(request.params.profileId)
    },
  )
  app.get<{ Params: { profileId: string }; Querystring: PageQuery }>(
    root + '/versions',
    {
      schema: {
        tags,
        operationId: 'listNavigationPolicyVersions',
        params,
        querystring: PageQuerySchema,
        response: {
          200: Type.Object(
            { items: Type.Array(NavigationPolicyVersionSummarySchema), meta: PaginationMetaSchema },
            { additionalProperties: false },
          ),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.navigationPolicies.listVersions(request.params.profileId, request.query)
    },
  )
  app.get<{ Params: { profileId: string; id: string } }>(
    root + '/versions/:id',
    {
      schema: {
        tags,
        operationId: 'getNavigationPolicyVersion',
        params: versionParams,
        response: { 200: NavigationPolicyVersionSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.navigationPolicies.getVersion(request.params.profileId, request.params.id)
    },
  )
  app.put<{ Params: { profileId: string }; Body: SaveNavigationPolicyDraft }>(
    root + '/draft',
    {
      schema: {
        tags,
        operationId: 'saveNavigationPolicyDraft',
        params,
        body: SaveNavigationPolicyDraftSchema,
        response: { 200: NavigationPolicyVersionSchema, ...errors },
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
      return services.navigationPolicies.saveDraft(request.params.profileId, request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
  app.post<{ Params: { profileId: string }; Body: NavigationPolicyPreviewRequest }>(
    root + '/preview',
    {
      schema: {
        tags,
        operationId: 'previewNavigationPolicy',
        params,
        body: NavigationPolicyPreviewRequestSchema,
        response: { 200: NavigationPolicyPreviewSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.navigationPolicies.preview(request.params.profileId, request.body)
    },
  )
  for (const action of ['publish', 'disable'] as const)
    app.post<{ Params: { profileId: string; id: string } }>(
      root + '/versions/:id/' + action,
      {
        schema: {
          tags,
          operationId:
            action === 'publish'
              ? 'publishNavigationPolicyVersion'
              : 'disableNavigationPolicyVersion',
          params: versionParams,
          response: { 200: NavigationPolicyVersionSchema, ...errors },
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
        return services.navigationPolicies[action](request.params.profileId, request.params.id, {
          actorUserId: session.user.id,
          requestId: request.id,
        })
      },
    )
}
