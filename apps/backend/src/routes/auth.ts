import {
  ApiErrorEnvelopeSchema,
  AuthSessionResponseSchema,
  BROWSHARE_API_VERSION,
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  PortalSessionListResponseSchema,
  PublicAuthConfigurationSchema,
  RegisterRequestSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type RegisterRequest,
} from '@browshare/contracts'
import type { FastifyRequest } from 'fastify'
import Type from 'typebox'

import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import {
  clearPortalSessionCookie,
  readPortalSessionToken,
  requirePortalSession,
  setPortalSessionCookie,
} from '../http-session.js'
import { type AuthenticationPort, type LoginContext } from '../services/authentication.js'

export function registerAuthRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  authentication: AuthenticationPort,
): void {
  app.get(
    `/api/${BROWSHARE_API_VERSION}/auth/config`,
    {
      schema: {
        tags: ['Authentication'],
        operationId: 'getPublicAuthConfiguration',
        response: { 200: PublicAuthConfigurationSchema },
      },
    },
    async () => authentication.getPublicConfiguration(),
  )

  app.post<{ Body: LoginRequest }>(
    `/api/${BROWSHARE_API_VERSION}/auth/login`,
    {
      schema: {
        tags: ['Authentication'],
        operationId: 'login',
        body: LoginRequestSchema,
        response: {
          200: AuthSessionResponseSchema,
          401: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const issued = await authentication.login(
        request.body.email,
        request.body.password,
        requestContext(request),
      )
      setPortalSessionCookie(reply, configuration, issued)
      return issued.response
    },
  )

  app.post<{ Body: RegisterRequest }>(
    `/api/${BROWSHARE_API_VERSION}/auth/register`,
    {
      schema: {
        tags: ['Authentication'],
        operationId: 'register',
        body: RegisterRequestSchema,
        response: {
          201: AuthSessionResponseSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const issued = await authentication.register(
        request.body.email,
        request.body.password,
        requestContext(request),
      )
      setPortalSessionCookie(reply, configuration, issued)
      reply.status(201)
      return issued.response
    },
  )

  app.get(
    `/api/${BROWSHARE_API_VERSION}/auth/session`,
    {
      schema: {
        tags: ['Authentication'],
        operationId: 'getCurrentSession',
        response: {
          200: AuthSessionResponseSchema,
          401: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const token = readPortalSessionToken(request)
      const session = token === undefined ? undefined : await authentication.authenticate(token)
      if (session === undefined || token === undefined) {
        clearPortalSessionCookie(reply, configuration)
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'A valid Portal Session is required.',
            requestId: request.id,
          },
        })
      }
      setPortalSessionCookie(reply, configuration, { token, response: session })
      return session
    },
  )

  app.post(
    `/api/${BROWSHARE_API_VERSION}/auth/logout`,
    {
      schema: {
        tags: ['Authentication'],
        operationId: 'logout',
        response: { 204: Type.Null(), 401: ApiErrorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const token = readPortalSessionToken(request)
      if (token !== undefined) await authentication.logout(token)
      clearPortalSessionCookie(reply, configuration)
      await reply.status(204).send(null)
    },
  )

  app.post<{ Body: ChangePasswordRequest }>(
    `/api/${BROWSHARE_API_VERSION}/auth/change-password`,
    {
      schema: {
        tags: ['Authentication'],
        operationId: 'changePassword',
        body: ChangePasswordRequestSchema,
        response: {
          204: Type.Null(),
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const { session } = await requirePortalSession(request, reply, configuration, authentication)
      await authentication.changePassword({
        userId: session.user.id,
        currentSessionId: session.sessionId,
        currentPassword: request.body.currentPassword,
        newPassword: request.body.newPassword,
        requestId: request.id,
      })
      await reply.status(204).send(null)
    },
  )

  app.get(
    `/api/${BROWSHARE_API_VERSION}/auth/sessions`,
    {
      schema: {
        tags: ['Authentication'],
        operationId: 'listPortalSessions',
        response: {
          200: PortalSessionListResponseSchema,
          401: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const { session } = await requirePortalSession(request, reply, configuration, authentication)
      return {
        items: await authentication.listSessions(session.user.id, session.sessionId),
      }
    },
  )

  app.delete<{ Params: { sessionId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/auth/sessions/:sessionId`,
    {
      schema: {
        tags: ['Authentication'],
        operationId: 'revokePortalSession',
        params: Type.Object(
          { sessionId: Type.String({ format: 'uuid' }) },
          { additionalProperties: false },
        ),
        response: {
          204: Type.Null(),
          401: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const { session } = await requirePortalSession(request, reply, configuration, authentication)
      await authentication.revokeSession({
        actorUserId: session.user.id,
        userId: session.user.id,
        sessionId: request.params.sessionId,
        requestId: request.id,
      })
      if (request.params.sessionId === session.sessionId) {
        clearPortalSessionCookie(reply, configuration)
      }
      await reply.status(204).send(null)
    },
  )

  app.post(
    `/api/${BROWSHARE_API_VERSION}/auth/sessions/revoke-all`,
    {
      schema: {
        tags: ['Authentication'],
        operationId: 'revokeAllPortalSessions',
        response: {
          204: Type.Null(),
          401: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const { session } = await requirePortalSession(request, reply, configuration, authentication)
      await authentication.revokeAllSessions({
        actorUserId: session.user.id,
        userId: session.user.id,
        requestId: request.id,
      })
      clearPortalSessionCookie(reply, configuration)
      await reply.status(204).send(null)
    },
  )
}

function requestContext(request: FastifyRequest): LoginContext {
  const userAgent = request.headers['user-agent']
  return {
    ip: request.ip,
    requestId: request.id,
    ...(userAgent === undefined ? {} : { userAgent }),
  }
}
