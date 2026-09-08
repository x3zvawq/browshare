import {
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  DEFAULT_SESSION_POLICY,
  SessionPolicyValuesSchema,
  SessionPolicyListQuerySchema,
  SessionPolicyListResponseSchema,
  SessionPolicyPreviewQuerySchema,
  SessionPolicyPreviewSchema,
  SessionPolicyResponseSchema,
  SaveSessionPolicyRequestSchema,
  type SessionPolicyListQuery,
  type SessionPolicyPreviewQuery,
  type SaveSessionPolicyRequest,
} from '@browshare/contracts'
import Type from 'typebox'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { SessionPolicyService } from '../services/session-policies.js'

export function registerSessionPolicyRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    sessionPolicies: Pick<SessionPolicyService, 'list' | 'get' | 'save' | 'delete' | 'preview'>
  },
) {
  const root = `/api/${BROWSHARE_API_VERSION}/session-policies`
  const errors = {
    400: ApiErrorEnvelopeSchema,
    401: ApiErrorEnvelopeSchema,
    403: ApiErrorEnvelopeSchema,
    404: ApiErrorEnvelopeSchema,
    409: ApiErrorEnvelopeSchema,
  }
  const tags = ['Session Policies']
  app.get(
    root + '/defaults',
    {
      schema: {
        tags,
        operationId: 'getSessionPolicyDefaults',
        response: { 200: SessionPolicyValuesSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return DEFAULT_SESSION_POLICY
    },
  )
  app.get<{ Querystring: SessionPolicyListQuery }>(
    root,
    {
      schema: {
        tags,
        operationId: 'listSessionPolicies',
        querystring: SessionPolicyListQuerySchema,
        response: { 200: SessionPolicyListResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.sessionPolicies.list(request.query)
    },
  )
  app.get<{ Querystring: SessionPolicyPreviewQuery }>(
    root + '/effective',
    {
      schema: {
        tags,
        operationId: 'previewSessionPolicy',
        querystring: SessionPolicyPreviewQuerySchema,
        response: { 200: SessionPolicyPreviewSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.sessionPolicies.preview(request.query)
    },
  )
  app.put<{ Body: SaveSessionPolicyRequest }>(
    root,
    {
      schema: {
        tags,
        operationId: 'saveSessionPolicy',
        body: SaveSessionPolicyRequestSchema,
        response: { 200: SessionPolicyResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        request.body.scope === 'GLOBAL' ? 'system.manage' : 'profile.manage',
      )
      return services.sessionPolicies.save(request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
  app.delete<{ Params: { id: string } }>(
    root + '/:id',
    {
      schema: {
        tags,
        operationId: 'deleteSessionPolicy',
        params: Type.Object(
          { id: Type.String({ format: 'uuid' }) },
          { additionalProperties: false },
        ),
        response: { 204: Type.Null(), ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      const policy = await services.sessionPolicies.get(request.params.id)
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        policy.scope === 'GLOBAL' ? 'system.manage' : 'profile.manage',
      )
      await services.sessionPolicies.delete(policy.id, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
      return reply.status(204).send()
    },
  )
}
