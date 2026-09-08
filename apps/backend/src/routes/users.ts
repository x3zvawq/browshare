import {
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  CreateUserRequestSchema,
  ResetPasswordRequestSchema,
  RoleListResponseSchema,
  SetUserRolesRequestSchema,
  SetUserStateRequestSchema,
  UpdateUserRequestSchema,
  UserListQuerySchema,
  UserListResponseSchema,
  UserResponseSchema,
  type CreateUserRequest,
  type ResetPasswordRequest,
  type SetUserRolesRequest,
  type SetUserStateRequest,
  type UpdateUserRequest,
  type UserListQuery,
} from '@browshare/contracts'
import Type from 'typebox'

import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import { clearPortalSessionCookie } from '../http-session.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { UserPort } from '../services/users.js'

const UserIdParamsSchema = Type.Object(
  { userId: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
)

export function registerUserRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    readonly authentication: AuthenticationPort
    readonly authorization: AuthorizationPort
    readonly users: UserPort
  },
): void {
  app.get<{ Querystring: UserListQuery }>(
    `/api/${BROWSHARE_API_VERSION}/users`,
    {
      schema: {
        tags: ['Users'],
        operationId: 'listUsers',
        querystring: UserListQuerySchema,
        response: {
          200: UserListResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'user.read')
      return services.users.list(request.query)
    },
  )

  app.post<{ Body: CreateUserRequest }>(
    `/api/${BROWSHARE_API_VERSION}/users`,
    {
      schema: {
        tags: ['Users'],
        operationId: 'createUser',
        body: CreateUserRequestSchema,
        response: {
          201: UserResponseSchema,
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
        'user.manage',
      )
      const created = await services.users.create(request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
      reply.status(201)
      return created
    },
  )

  app.get<{ Params: { userId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/users/:userId`,
    {
      schema: {
        tags: ['Users'],
        operationId: 'getUser',
        params: UserIdParamsSchema,
        response: {
          200: UserResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'user.read')
      return services.users.get(request.params.userId)
    },
  )

  app.patch<{ Params: { userId: string }; Body: UpdateUserRequest }>(
    `/api/${BROWSHARE_API_VERSION}/users/:userId`,
    {
      schema: {
        tags: ['Users'],
        operationId: 'updateUser',
        params: UserIdParamsSchema,
        body: UpdateUserRequestSchema,
        response: {
          200: UserResponseSchema,
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
        'user.manage',
      )
      return services.users.update(request.params.userId, request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )

  app.put<{ Params: { userId: string }; Body: SetUserStateRequest }>(
    `/api/${BROWSHARE_API_VERSION}/users/:userId/state`,
    {
      schema: {
        tags: ['Users'],
        operationId: 'setUserState',
        params: UserIdParamsSchema,
        body: SetUserStateRequestSchema,
        response: {
          200: UserResponseSchema,
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
        'user.manage',
      )
      const updated = await services.users.setState(request.params.userId, request.body.state, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
      if (request.params.userId === session.user.id && request.body.state === 'DISABLED') {
        clearPortalSessionCookie(reply, configuration)
      }
      return updated
    },
  )

  app.put<{ Params: { userId: string }; Body: SetUserRolesRequest }>(
    `/api/${BROWSHARE_API_VERSION}/users/:userId/roles`,
    {
      schema: {
        tags: ['Users'],
        operationId: 'setUserRoles',
        params: UserIdParamsSchema,
        body: SetUserRolesRequestSchema,
        response: {
          200: UserResponseSchema,
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
        'user.manage',
      )
      return services.users.setRoles(request.params.userId, request.body.roleIds, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )

  app.post<{ Params: { userId: string }; Body: ResetPasswordRequest }>(
    `/api/${BROWSHARE_API_VERSION}/users/:userId/reset-password`,
    {
      schema: {
        tags: ['Users'],
        operationId: 'resetUserPassword',
        params: UserIdParamsSchema,
        body: ResetPasswordRequestSchema,
        response: {
          204: Type.Null(),
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'user.manage',
      )
      await services.authentication.resetUserPassword({
        actorUserId: session.user.id,
        userId: request.params.userId,
        newPassword: request.body.newPassword,
        requestId: request.id,
      })
      if (request.params.userId === session.user.id) {
        clearPortalSessionCookie(reply, configuration)
      }
      await reply.status(204).send(null)
    },
  )

  app.delete<{ Params: { userId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/users/:userId`,
    {
      schema: {
        tags: ['Users'],
        operationId: 'deleteUser',
        params: UserIdParamsSchema,
        response: {
          204: Type.Null(),
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
        'user.manage',
      )
      await services.users.delete(request.params.userId, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
      if (request.params.userId === session.user.id) {
        clearPortalSessionCookie(reply, configuration)
      }
      await reply.status(204).send(null)
    },
  )

  app.get(
    `/api/${BROWSHARE_API_VERSION}/roles`,
    {
      schema: {
        tags: ['Users'],
        operationId: 'listRoles',
        response: {
          200: RoleListResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'user.read')
      return { items: await services.users.listRoles() }
    },
  )
}
