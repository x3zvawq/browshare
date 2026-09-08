import {
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  CreateProxyRequestSchema,
  ProxyProbeRequestSchema,
  ProxyProbeResultSchema,
  type ProxyProbeRequest,
  ProxyListQuerySchema,
  ProxyListResponseSchema,
  ProxyResponseSchema,
  UpdateProxyRequestSchema,
  type CreateProxyRequest,
  type ProxyListQuery,
  type UpdateProxyRequest,
} from '@browshare/contracts'
import Type from 'typebox'

import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { ProxyPort } from '../services/proxies.js'

const ProxyIdParamsSchema = Type.Object(
  { proxyId: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
)

export function registerProxyRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    readonly authentication: AuthenticationPort
    readonly authorization: AuthorizationPort
    readonly proxies: ProxyPort
  },
): void {
  app.post<{ Params: { proxyId: string }; Body: ProxyProbeRequest }>(
    `/api/${BROWSHARE_API_VERSION}/proxies/:proxyId/probe`,
    {
      schema: {
        operationId: 'probeProxy',
        tags: ['Proxies'],
        params: ProxyIdParamsSchema,
        body: ProxyProbeRequestSchema,
        response: {
          200: ProxyProbeResultSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
          504: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'proxy.manage',
      )
      await requirePermission(request, reply, configuration, services, 'worker.read')
      return services.proxies.probe(request.params.proxyId, request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )

  app.get<{ Querystring: ProxyListQuery }>(
    `/api/${BROWSHARE_API_VERSION}/proxies`,
    {
      schema: {
        tags: ['Proxies'],
        operationId: 'listProxies',
        querystring: ProxyListQuerySchema,
        response: {
          200: ProxyListResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(request, reply, configuration, services, 'proxy.read')
      return services.proxies.list(request.query, {
        credentialsReadable: await services.authorization.hasPermission(
          session.user.id,
          'proxy.credential.read',
        ),
      })
    },
  )

  app.get<{ Params: { proxyId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/proxies/:proxyId`,
    {
      schema: {
        tags: ['Proxies'],
        operationId: 'getProxy',
        params: ProxyIdParamsSchema,
        response: {
          200: ProxyResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(request, reply, configuration, services, 'proxy.read')
      return services.proxies.get(request.params.proxyId, {
        credentialsReadable: await services.authorization.hasPermission(
          session.user.id,
          'proxy.credential.read',
        ),
      })
    },
  )

  app.post<{ Body: CreateProxyRequest }>(
    `/api/${BROWSHARE_API_VERSION}/proxies`,
    {
      schema: {
        tags: ['Proxies'],
        operationId: 'createProxy',
        body: CreateProxyRequestSchema,
        response: {
          201: ProxyResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'proxy.manage',
      )
      const read = {
        credentialsReadable: await services.authorization.hasPermission(
          session.user.id,
          'proxy.credential.read',
        ),
      }
      const created = await services.proxies.create(
        request.body,
        { actorUserId: session.user.id, requestId: request.id },
        read,
      )
      reply.status(201)
      return created
    },
  )

  app.patch<{ Params: { proxyId: string }; Body: UpdateProxyRequest }>(
    `/api/${BROWSHARE_API_VERSION}/proxies/:proxyId`,
    {
      schema: {
        tags: ['Proxies'],
        operationId: 'updateProxy',
        params: ProxyIdParamsSchema,
        body: UpdateProxyRequestSchema,
        response: {
          200: ProxyResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'proxy.manage',
      )
      return services.proxies.update(
        request.params.proxyId,
        request.body,
        { actorUserId: session.user.id, requestId: request.id },
        {
          credentialsReadable: await services.authorization.hasPermission(
            session.user.id,
            'proxy.credential.read',
          ),
        },
      )
    },
  )

  app.delete<{ Params: { proxyId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/proxies/:proxyId`,
    {
      schema: {
        tags: ['Proxies'],
        operationId: 'deleteProxy',
        params: ProxyIdParamsSchema,
        response: {
          204: Type.Null(),
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'proxy.manage',
      )
      await services.proxies.delete(request.params.proxyId, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
      await reply.status(204).send()
    },
  )
}
