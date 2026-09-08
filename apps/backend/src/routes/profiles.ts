import type { ProfileRuntimePort } from '../services/profile-runtimes.js'
import {
  ApiErrorEnvelopeSchema,
  SetProfileRuntimeRequestSchema,
  type SetProfileRuntimeRequest,
  BROWSHARE_API_VERSION,
  CreateProfileRequestSchema,
  ProfileListQuerySchema,
  ProfileListResponseSchema,
  ProfileResponseSchema,
  RequestProfileDeletionSchema,
  SetProfileBusinessStateRequestSchema,
  UpdateProfileRequestSchema,
  type CreateProfileRequest,
  type ProfileListQuery,
  type RequestProfileDeletion,
  type SetProfileBusinessStateRequest,
  type UpdateProfileRequest,
} from '@browshare/contracts'
import Type from 'typebox'

import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { ProfilePort } from '../services/profiles.js'

const ProfileIdParamsSchema = Type.Object(
  { profileId: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
)

export function registerProfileRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    readonly authentication: AuthenticationPort
    readonly authorization: AuthorizationPort
    readonly profiles: ProfilePort
    readonly profileRuntimes: ProfileRuntimePort
  },
): void {
  app.put<{ Params: { profileId: string }; Body: SetProfileRuntimeRequest }>(
    `/api/${BROWSHARE_API_VERSION}/profiles/:profileId/runtime`,
    {
      schema: {
        tags: ['Profiles'],
        operationId: 'setProfileRuntime',
        params: ProfileIdParamsSchema,
        body: SetProfileRuntimeRequestSchema,
        response: {
          202: ProfileResponseSchema,
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
        'profile.manage',
      )
      const result = await services.profileRuntimes.setRuntime(
        request.params.profileId,
        request.body,
        { actorUserId: session.user.id, requestId: request.id },
      )
      reply.status(202)
      return result
    },
  )

  app.get<{ Querystring: ProfileListQuery }>(
    `/api/${BROWSHARE_API_VERSION}/profiles`,
    {
      schema: {
        tags: ['Profiles'],
        operationId: 'listProfiles',
        querystring: ProfileListQuerySchema,
        response: {
          200: ProfileListResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.profiles.list(request.query)
    },
  )

  app.get<{ Params: { profileId: string } }>(
    `/api/${BROWSHARE_API_VERSION}/profiles/:profileId`,
    {
      schema: {
        tags: ['Profiles'],
        operationId: 'getProfile',
        params: ProfileIdParamsSchema,
        response: {
          200: ProfileResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.profiles.get(request.params.profileId)
    },
  )

  app.post<{ Body: CreateProfileRequest }>(
    `/api/${BROWSHARE_API_VERSION}/profiles`,
    {
      schema: {
        tags: ['Profiles'],
        operationId: 'createProfile',
        body: CreateProfileRequestSchema,
        response: {
          201: ProfileResponseSchema,
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
        'profile.manage',
      )
      const created = await services.profiles.create(request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
      reply.status(201)
      return created
    },
  )

  app.patch<{ Params: { profileId: string }; Body: UpdateProfileRequest }>(
    `/api/${BROWSHARE_API_VERSION}/profiles/:profileId`,
    {
      schema: {
        tags: ['Profiles'],
        operationId: 'updateProfile',
        params: ProfileIdParamsSchema,
        body: UpdateProfileRequestSchema,
        response: {
          200: ProfileResponseSchema,
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
        'profile.manage',
      )
      return services.profiles.update(request.params.profileId, request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )

  app.put<{
    Params: { profileId: string }
    Body: SetProfileBusinessStateRequest
  }>(
    `/api/${BROWSHARE_API_VERSION}/profiles/:profileId/state`,
    {
      schema: {
        tags: ['Profiles'],
        operationId: 'setProfileBusinessState',
        params: ProfileIdParamsSchema,
        body: SetProfileBusinessStateRequestSchema,
        response: {
          200: ProfileResponseSchema,
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
        'profile.manage',
      )
      return services.profiles.setState(request.params.profileId, request.body.state, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )

  app.post<{ Params: { profileId: string }; Body: RequestProfileDeletion }>(
    `/api/${BROWSHARE_API_VERSION}/profiles/:profileId/deletion`,
    {
      schema: {
        tags: ['Profiles'],
        operationId: 'requestProfileDeletion',
        params: ProfileIdParamsSchema,
        body: RequestProfileDeletionSchema,
        response: {
          202: ProfileResponseSchema,
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
        'profile.manage',
      )
      const profile = await services.profiles.requestDeletion(
        request.params.profileId,
        request.body.expectedName,
        { actorUserId: session.user.id, requestId: request.id },
      )
      reply.status(202)
      return profile
    },
  )
}
