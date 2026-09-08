import {
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  ProfileGroupListQuerySchema,
  ProfileGroupListResponseSchema,
  ProfileGroupResponseSchema,
  CreateProfileGroupRequestSchema,
  UpdateProfileGroupRequestSchema,
  SetProfileBusinessStateRequestSchema,
  ProfileGroupMembersResponseSchema,
  SetProfileGroupMembersRequestSchema,
  ProfileGrantsResponseSchema,
  SetProfileGrantsRequestSchema,
  ProfileSubjectQuerySchema,
  ProfileSubjectListResponseSchema,
  ProfileListQuerySchema,
  AccessibleProfileListResponseSchema,
  AccessibleProfileSchema,
  type ProfileGroupListQuery,
  type CreateProfileGroupRequest,
  type UpdateProfileGroupRequest,
  type SetProfileBusinessStateRequest,
  type SetProfileGroupMembersRequest,
  type SetProfileGrantsRequest,
  type ProfileSubjectQuery,
  type ProfileListQuery,
} from '@browshare/contracts'
import Type from 'typebox'
import type { BackendApp } from '../app.js'
import type { BackendConfiguration } from '../configuration.js'
import { requirePermission } from '../http-authorization.js'
import type { AuthenticationPort } from '../services/authentication.js'
import type { AuthorizationPort } from '../services/authorization.js'
import type { ProfileGroupPort } from '../services/profile-groups.js'
import type { ProfilePort } from '../services/profiles.js'

const idParams = Type.Object(
  { id: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
)
const errors = {
  400: ApiErrorEnvelopeSchema,
  401: ApiErrorEnvelopeSchema,
  403: ApiErrorEnvelopeSchema,
  404: ApiErrorEnvelopeSchema,
  409: ApiErrorEnvelopeSchema,
}
type Params = { id: string }
export function registerProfileGroupRoutes(
  app: BackendApp,
  configuration: BackendConfiguration,
  services: {
    authentication: AuthenticationPort
    authorization: AuthorizationPort
    profileGroups: ProfileGroupPort
    profiles: ProfilePort
  },
) {
  const root = `/api/${BROWSHARE_API_VERSION}`
  const tags = ['Profile Groups']
  app.get<{ Querystring: ProfileGroupListQuery }>(
    root + '/profile-groups',
    {
      schema: {
        tags,
        operationId: 'listProfileGroups',
        querystring: ProfileGroupListQuerySchema,
        response: { 200: ProfileGroupListResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.profileGroups.list(request.query)
    },
  )
  app.get<{ Querystring: ProfileSubjectQuery }>(
    root + '/profile-groups/subjects',
    {
      schema: {
        tags,
        operationId: 'listProfileAccessSubjects',
        querystring: ProfileSubjectQuerySchema,
        response: { 200: ProfileSubjectListResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.profileGroups.subjects(request.query)
    },
  )
  app.post<{ Body: CreateProfileGroupRequest }>(
    root + '/profile-groups',
    {
      schema: {
        tags,
        operationId: 'createProfileGroup',
        body: CreateProfileGroupRequestSchema,
        response: { 201: ProfileGroupResponseSchema, ...errors },
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
      const value = await services.profileGroups.create(request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
      return reply.status(201).send(value)
    },
  )
  app.get<{ Params: Params }>(
    root + '/profile-groups/:id',
    {
      schema: {
        tags,
        operationId: 'getProfileGroup',
        params: idParams,
        response: { 200: ProfileGroupResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.profileGroups.get(request.params.id)
    },
  )
  app.patch<{ Params: Params; Body: UpdateProfileGroupRequest }>(
    root + '/profile-groups/:id',
    {
      schema: {
        tags,
        operationId: 'updateProfileGroup',
        params: idParams,
        body: UpdateProfileGroupRequestSchema,
        response: { 200: ProfileGroupResponseSchema, ...errors },
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
      return services.profileGroups.update(request.params.id, request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
  app.put<{ Params: Params; Body: SetProfileBusinessStateRequest }>(
    root + '/profile-groups/:id/state',
    {
      schema: {
        tags,
        operationId: 'setProfileGroupState',
        params: idParams,
        body: SetProfileBusinessStateRequestSchema,
        response: { 200: ProfileGroupResponseSchema, ...errors },
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
      return services.profileGroups.setState(request.params.id, request.body.state, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
  app.delete<{ Params: Params }>(
    root + '/profile-groups/:id',
    {
      schema: {
        tags,
        operationId: 'deleteProfileGroup',
        params: idParams,
        response: { 204: Type.Null(), ...errors },
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
      await services.profileGroups.delete(request.params.id, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
      return reply.status(204).send(null)
    },
  )
  app.get<{ Params: Params }>(
    root + '/profile-groups/:id/members',
    {
      schema: {
        tags,
        operationId: 'getProfileGroupMembers',
        params: idParams,
        response: { 200: ProfileGroupMembersResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.profileGroups.getMembers(request.params.id)
    },
  )
  app.put<{ Params: Params; Body: SetProfileGroupMembersRequest }>(
    root + '/profile-groups/:id/members',
    {
      schema: {
        tags,
        operationId: 'setProfileGroupMembers',
        params: idParams,
        body: SetProfileGroupMembersRequestSchema,
        response: { 200: ProfileGroupMembersResponseSchema, ...errors },
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
      return services.profileGroups.setMembers(request.params.id, request.body, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
  app.get<{ Params: Params }>(
    root + '/profiles/:id/grants',
    {
      schema: {
        tags,
        operationId: 'getProfileGrants',
        params: idParams,
        response: { 200: ProfileGrantsResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requirePermission(request, reply, configuration, services, 'profile.read')
      return services.profileGroups.getGrants(request.params.id)
    },
  )
  app.put<{ Params: Params; Body: SetProfileGrantsRequest }>(
    root + '/profiles/:id/grants',
    {
      schema: {
        tags,
        operationId: 'setProfileGrants',
        params: idParams,
        body: SetProfileGrantsRequestSchema,
        response: { 200: ProfileGrantsResponseSchema, ...errors },
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
      return services.profileGroups.setGrants(request.params.id, request.body.userIds, {
        actorUserId: session.user.id,
        requestId: request.id,
      })
    },
  )
  app.get<{ Querystring: ProfileListQuery }>(
    root + '/workspace/profiles',
    {
      schema: {
        tags: ['Workspace'],
        operationId: 'listAccessibleProfiles',
        querystring: ProfileListQuerySchema,
        response: { 200: AccessibleProfileListResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'session.use',
      )
      return services.profiles.listAccessible(session.user.id, request.query)
    },
  )
  app.get<{ Params: Params }>(
    root + '/workspace/profiles/:id',
    {
      schema: {
        tags: ['Workspace'],
        operationId: 'getAccessibleProfile',
        params: idParams,
        response: { 200: AccessibleProfileSchema, ...errors },
      },
    },
    async (request, reply) => {
      const session = await requirePermission(
        request,
        reply,
        configuration,
        services,
        'session.use',
      )
      return services.profiles.getAccessible(session.user.id, request.params.id)
    },
  )
}
