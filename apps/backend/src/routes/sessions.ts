import {
  SessionContinueRequestSchema,
  SessionContinueResponseSchema,
  type SessionContinueRequest,
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  TabSessionListQuerySchema,
  TabSessionListResponseSchema,
  TabSessionSchema,
  TabSessionRenameRequestSchema,
  type TabSessionRenameRequest,
  TabSessionCreateRequestSchema,
  type TabSessionCreateRequest,
  SessionViewerRequestSchema,
  SessionViewerLaunchSchema,
  type SessionViewerRequest,
  type TabSessionListQuery,
} from '@browshare/contracts'
import Type from 'typebox'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { requirePortalSession } from '../http-session.js'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { SessionService } from '../services/sessions.js'
import type { SessionCreationService } from '../services/session-creation.js'
import type { SessionViewerService } from '../services/session-viewers.js'

export function registerSessionRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    sessions: Pick<SessionService, 'list' | 'get' | 'close' | 'rename'>
    sessionCreation: Pick<SessionCreationService, 'create'>
    sessionViewers: Pick<SessionViewerService, 'connect' | 'continue'>
  },
): void {
  const root = `/api/${BROWSHARE_API_VERSION}/sessions`
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
  async function requireOwnerPermission(request: FastifyRequest, reply: FastifyReply, id: string) {
    const { session: auth } = await requirePortalSession(
      request,
      reply,
      configuration,
      services.authentication,
    )
    const session = await services.sessions.get(auth.user.id, id)
    await services.authorization.requirePermission(
      auth.user.id,
      session.kind === 'MAINTENANCE' ? 'profile.maintain' : 'session.use',
    )
    return auth
  }
  app.post<{ Body: TabSessionCreateRequest }>(
    root,
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'createTabSession',
        body: TabSessionCreateRequestSchema,
        response: { 202: TabSessionSchema, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requirePermission(request, reply, configuration, services, 'session.use')
      return reply
        .status(202)
        .send(await services.sessionCreation.create(auth.user.id, request.body, request.id))
    },
  )
  app.get<{ Querystring: TabSessionListQuery }>(
    root,
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'listTabSessions',
        querystring: TabSessionListQuerySchema,
        response: { 200: TabSessionListResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { session: auth } = await requirePortalSession(
        request,
        reply,
        configuration,
        services.authentication,
      )
      const permissions = await services.authorization.listUserPermissionCodes(auth.user.id)
      const kinds: ('NORMAL' | 'MAINTENANCE')[] = []
      if (permissions.includes('session.use')) kinds.push('NORMAL')
      if (permissions.includes('profile.maintain')) kinds.push('MAINTENANCE')
      if (!kinds.length) await services.authorization.requirePermission(auth.user.id, 'session.use')
      return services.sessions.list(auth.user.id, request.query, kinds)
    },
  )
  app.get<{ Params: { id: string } }>(
    root + '/:id',
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'getTabSession',
        params,
        response: { 200: TabSessionSchema, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requireOwnerPermission(request, reply, request.params.id)
      return services.sessions.get(auth.user.id, request.params.id)
    },
  )
  app.patch<{ Params: { id: string }; Body: TabSessionRenameRequest }>(
    root + '/:id',
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'renameTabSession',
        params,
        body: TabSessionRenameRequestSchema,
        response: { 200: TabSessionSchema, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requireOwnerPermission(request, reply, request.params.id)
      return services.sessions.rename(
        auth.user.id,
        request.params.id,
        request.body.displayName,
        request.id,
      )
    },
  )
  app.post<{ Params: { id: string }; Body: SessionViewerRequest }>(
    root + '/:id/viewer',
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'connectSessionViewer',
        params,
        body: SessionViewerRequestSchema,
        response: { 200: SessionViewerLaunchSchema, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requireOwnerPermission(request, reply, request.params.id)
      reply.header('cache-control', 'no-store')
      return services.sessionViewers.connect(
        auth.user.id,
        request.params.id,
        request.body,
        request.id,
      )
    },
  )
  app.post<{ Params: { id: string }; Body: SessionContinueRequest }>(
    root + '/:id/continue',
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'continueTabSession',
        params,
        body: SessionContinueRequestSchema,
        response: { 200: SessionContinueResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requireOwnerPermission(request, reply, request.params.id)
      reply.header('cache-control', 'no-store')
      return services.sessionViewers.continue(
        auth.user.id,
        request.params.id,
        request.body,
        request.id,
      )
    },
  )
  app.post<{ Params: { id: string } }>(
    root + '/:id/close',
    {
      schema: {
        tags: ['Sessions'],
        operationId: 'closeTabSession',
        params,
        response: { 202: TabSessionSchema, ...errors },
      },
    },
    async (request, reply) => {
      const auth = await requireOwnerPermission(request, reply, request.params.id)
      const session = await services.sessions.close(auth.user.id, request.params.id, request.id)
      return reply.status(202).send(session)
    },
  )
}
