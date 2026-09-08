import {
  ProfileStorageSummaryProperties,
  StorageQuotaBytesSchema,
  WorkerStorageFactSchema,
} from './storage.js'
export * from './storage.js'
export * from './bootstrap.js'
export * from './diagnostic-bundle.js'
export * from './profile-contexts.js'
export * from './worker-recovery.js'
import { WorkerCleanupFailureSchema, ProfileRuntimeRecoverySchema } from './worker-recovery.js'
import { ProfileRouteSummaryProperties } from './proxy-runtime.js'
export * from './proxy-runtime.js'
import { ViewerFocusPolicySchema } from './system-settings.js'
export * from './downloads.js'
import { ProfileQualityPolicySchema } from './media-policy.js'
export { ProfileQualityPolicySchema, type ProfileQualityPolicy } from './media-policy.js'
import Type from 'typebox'

import { WorkerCapabilityReportSchema, WorkerRuntimeMetricsSchema } from './worker-control.js'
import { SessionPolicyValuesSchema, SessionRecycleStateSchema } from './session-policy.js'

export * from './worker-control.js'
export * from './gateway-control.js'
export * from './session-policy.js'
export * from './system-settings.js'
export * from './navigation-policies.js'

export const BROWSHARE_VERSION = '0.1.0' as const
export const BROWSHARE_API_VERSION = 'v1' as const

export const ServiceNameSchema = Type.Enum(['backend', 'worker'] as const)
export type ServiceName = Type.Static<typeof ServiceNameSchema>

export const HealthLiveSchema = Type.Object(
  {
    status: Type.Literal('ok'),
    service: ServiceNameSchema,
    version: Type.String({ minLength: 1, maxLength: 64 }),
    time: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type HealthLive = Type.Static<typeof HealthLiveSchema>

export const HealthReadySchema = Type.Object(
  {
    status: Type.Enum(['ready', 'not-ready'] as const),
    service: ServiceNameSchema,
    version: Type.String({ minLength: 1, maxLength: 64 }),
    time: Type.String({ format: 'date-time' }),
    checks: Type.Record(Type.String({ minLength: 1, maxLength: 64 }), Type.String()),
  },
  { additionalProperties: false },
)
export type HealthReady = Type.Static<typeof HealthReadySchema>

export const VersionResponseSchema = Type.Object(
  {
    name: Type.Literal('BrowShare'),
    service: ServiceNameSchema,
    version: Type.String({ minLength: 1, maxLength: 64 }),
    apiVersion: Type.Literal(BROWSHARE_API_VERSION),
  },
  { additionalProperties: false },
)
export type VersionResponse = Type.Static<typeof VersionResponseSchema>

export const ApiErrorCodeSchema = Type.Enum([
  'LOW_DISK',
  'CRITICAL_DISK',
  'WORKER_STORAGE_QUOTA_EXCEEDED',
  'PROFILE_STORAGE_QUOTA_EXCEEDED',
  'STORAGE_UNAVAILABLE',
  'STORAGE_POLICY_STALE',
  'AUTHENTICATION_FAILED',
  'BAD_REQUEST',
  'CONFLICT',
  'FORBIDDEN',
  'INTERNAL_ERROR',
  'LAST_SYSTEM_MANAGER',
  'NOT_FOUND',
  'PASSWORD_MISMATCH',
  'PROXY_IN_USE',
  'REGISTRATION_DISABLED',
  'UNAUTHORIZED',
  'VALIDATION_FAILED',
  'WORKER_ENROLLMENT_INVALID',
  'WORKER_COMMAND_FAILED',
  'WORKER_COMMAND_TIMEOUT',
  'WORKER_CREDENTIAL_NOT_FOUND',
  'WORKER_CREDENTIAL_ROTATION_INVALID',
  'WORKER_NAME_CONFLICT',
  'WORKER_LAST_CREDENTIAL',
  'WORKER_RETIREMENT_BLOCKED',
  'WORKER_UNAVAILABLE',
] as const)
export type ApiErrorCode = Type.Static<typeof ApiErrorCodeSchema>

export const ApiErrorEnvelopeSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: ApiErrorCodeSchema,
        message: Type.String({ minLength: 1, maxLength: 512 }),
        requestId: Type.String({ minLength: 1, maxLength: 128 }),
        details: Type.Optional(Type.Unknown()),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type ApiErrorEnvelope = Type.Static<typeof ApiErrorEnvelopeSchema>

export const PageQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
)
export type PageQuery = Type.Static<typeof PageQuerySchema>

export const TabSessionStatusSchema = Type.Enum([
  'RESERVED',
  'CREATING',
  'READY',
  'CONNECTED',
  'SUSPENDED',
  'DISCONNECTED',
  'CLOSING',
  'CLOSED',
  'FAILED',
] as const)

export const TabSessionKindSchema = Type.Enum(['NORMAL', 'MAINTENANCE'] as const)
export type TabSessionKind = Type.Static<typeof TabSessionKindSchema>

export const TabSessionSchema = Type.Object(
  {
    ...ProfileRouteSummaryProperties,
    ...ProfileStorageSummaryProperties,
    id: Type.String({ format: 'uuid' }),
    profileId: Type.String({ format: 'uuid' }),
    profileName: Type.String(),
    kind: TabSessionKindSchema,
    status: TabSessionStatusSchema,
    displayName: Type.Union([Type.String(), Type.Null()]),
    remoteTitle: Type.Union([Type.String(), Type.Null()]),
    hasCustomDisplayName: Type.Boolean(),
    recycling: Type.Union([SessionRecycleStateSchema, Type.Null()]),
    serverTime: Type.String({ format: 'date-time' }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
    closingAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    closedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    closeReason: Type.Union([Type.String(), Type.Null()]),
    failureCode: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
)
export type TabSession = Type.Static<typeof TabSessionSchema>

export const TabSessionRenameRequestSchema = Type.Object(
  { displayName: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]) },
  { additionalProperties: false },
)
export type TabSessionRenameRequest = Type.Static<typeof TabSessionRenameRequestSchema>

export const TabSessionListQuerySchema = Type.Object(
  {
    ...PageQuerySchema.properties,
    profileId: Type.Optional(Type.String({ format: 'uuid' })),
    status: Type.Optional(TabSessionStatusSchema),
    kind: Type.Optional(TabSessionKindSchema),
  },
  { additionalProperties: false },
)
export type TabSessionListQuery = Type.Static<typeof TabSessionListQuerySchema>

export const PaginationMetaSchema = Type.Object(
  {
    nextCursor: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type PaginationMeta = Type.Static<typeof PaginationMetaSchema>

export const TabSessionListResponseSchema = Type.Object(
  {
    items: Type.Array(TabSessionSchema),
    meta: PaginationMetaSchema,
  },
  { additionalProperties: false },
)
export type TabSessionListResponse = Type.Static<typeof TabSessionListResponseSchema>

export const AdminTabSessionSchema = Type.Object(
  {
    ...TabSessionSchema.properties,
    user: Type.Object(
      { id: Type.String({ format: 'uuid' }), name: Type.String() },
      { additionalProperties: false },
    ),
    worker: Type.Object(
      { id: Type.String({ format: 'uuid' }), name: Type.String() },
      { additionalProperties: false },
    ),
    runtimeId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    profileGeneration: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    viewerGeneration: Type.Integer({ minimum: 0 }),
    leaseExpiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    runtimeObservedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    viewerConnectedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    viewerDisconnectedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    lastInputAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    lastFrameChangedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type AdminTabSession = Type.Static<typeof AdminTabSessionSchema>
export const AdminTabSessionListQuerySchema = Type.Object(
  {
    ...TabSessionListQuerySchema.properties,
    scope: Type.Optional(Type.Enum(['ACTIVE', 'ALL'] as const)),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    userId: Type.Optional(Type.String({ format: 'uuid' })),
    workerId: Type.Optional(Type.String({ format: 'uuid' })),
  },
  { additionalProperties: false },
)
export type AdminTabSessionListQuery = Type.Static<typeof AdminTabSessionListQuerySchema>
export const AdminTabSessionListResponseSchema = Type.Object(
  { items: Type.Array(AdminTabSessionSchema), meta: PaginationMetaSchema },
  { additionalProperties: false },
)
export type AdminTabSessionListResponse = Type.Static<typeof AdminTabSessionListResponseSchema>

export const AuthUserSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    email: Type.String({ minLength: 3, maxLength: 320 }),
    displayName: Type.String({ minLength: 1, maxLength: 128 }),
    permissions: Type.Array(Type.String({ minLength: 1, maxLength: 96 })),
  },
  { additionalProperties: false },
)
export type AuthUser = Type.Static<typeof AuthUserSchema>

export const AuthSessionResponseSchema = Type.Object(
  {
    user: AuthUserSchema,
    expiresAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type AuthSessionResponse = Type.Static<typeof AuthSessionResponseSchema>

export const PublicAuthConfigurationSchema = Type.Object(
  {
    registrationOpen: Type.Boolean(),
    emailVerificationRequired: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type PublicAuthConfiguration = Type.Static<typeof PublicAuthConfigurationSchema>

export const LoginRequestSchema = Type.Object(
  {
    email: Type.String({ minLength: 3, maxLength: 320 }),
    password: Type.String({ minLength: 1, maxLength: 1024 }),
  },
  { additionalProperties: false },
)
export type LoginRequest = Type.Static<typeof LoginRequestSchema>

export const RegisterRequestSchema = Type.Object(
  {
    email: Type.String({ minLength: 3, maxLength: 320 }),
    password: Type.String({ minLength: 10, maxLength: 1024 }),
  },
  { additionalProperties: false },
)
export type RegisterRequest = Type.Static<typeof RegisterRequestSchema>

export const ChangePasswordRequestSchema = Type.Object(
  {
    currentPassword: Type.String({ minLength: 1, maxLength: 1024 }),
    newPassword: Type.String({ minLength: 10, maxLength: 1024 }),
  },
  { additionalProperties: false },
)
export type ChangePasswordRequest = Type.Static<typeof ChangePasswordRequestSchema>

export const ResetPasswordRequestSchema = Type.Object(
  { newPassword: Type.String({ minLength: 10, maxLength: 1024 }) },
  { additionalProperties: false },
)
export type ResetPasswordRequest = Type.Static<typeof ResetPasswordRequestSchema>

export const PortalSessionDeviceSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    deviceName: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    userAgentSummary: Type.Union([Type.String({ minLength: 1, maxLength: 512 }), Type.Null()]),
    lastSeenAt: Type.String({ format: 'date-time' }),
    expiresAt: Type.String({ format: 'date-time' }),
    current: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type PortalSessionDevice = Type.Static<typeof PortalSessionDeviceSchema>

export const PortalSessionListResponseSchema = Type.Object(
  { items: Type.Array(PortalSessionDeviceSchema) },
  { additionalProperties: false },
)
export type PortalSessionListResponse = Type.Static<typeof PortalSessionListResponseSchema>

export const WorkerEnrollmentStatusSchema = Type.Enum([
  'ACTIVE',
  'CONSUMED',
  'REVOKED',
  'EXPIRED',
] as const)
export type WorkerEnrollmentStatus = Type.Static<typeof WorkerEnrollmentStatusSchema>

export const WorkerEnrollmentResponseSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    displayName: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    status: WorkerEnrollmentStatusSchema,
    expiresAt: Type.String({ format: 'date-time' }),
    consumedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    consumedByWorkerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    revokedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type WorkerEnrollmentResponse = Type.Static<typeof WorkerEnrollmentResponseSchema>

export const IssuedWorkerEnrollmentResponseSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    displayName: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    status: WorkerEnrollmentStatusSchema,
    expiresAt: Type.String({ format: 'date-time' }),
    consumedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    consumedByWorkerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    revokedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    token: Type.String({ minLength: 40, maxLength: 128 }),
  },
  { additionalProperties: false },
)
export type IssuedWorkerEnrollmentResponse = Type.Static<
  typeof IssuedWorkerEnrollmentResponseSchema
>

export const CreateWorkerEnrollmentRequestSchema = Type.Object(
  {
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    expiresInSeconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 86_400 })),
  },
  { additionalProperties: false },
)
export type CreateWorkerEnrollmentRequest = Type.Static<typeof CreateWorkerEnrollmentRequestSchema>

export const WorkerEnrollmentListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    status: Type.Optional(Type.Enum(['ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED', 'ALL'] as const)),
  },
  { additionalProperties: false },
)
export type WorkerEnrollmentListQuery = Type.Static<typeof WorkerEnrollmentListQuerySchema>

export const WorkerEnrollmentListResponseSchema = Type.Object(
  {
    items: Type.Array(WorkerEnrollmentResponseSchema),
    meta: PaginationMetaSchema,
  },
  { additionalProperties: false },
)
export type WorkerEnrollmentListResponse = Type.Static<typeof WorkerEnrollmentListResponseSchema>

export const WorkerRegistrationMetadataSchema = Type.Object(
  {
    hostname: Type.String({ minLength: 1, maxLength: 255 }),
    platform: Type.String({ minLength: 1, maxLength: 32 }),
    architecture: Type.String({ minLength: 1, maxLength: 32 }),
    workerVersion: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
)
export type WorkerRegistrationMetadata = Type.Static<typeof WorkerRegistrationMetadataSchema>

export const RegisterWorkerRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 128 }),
    publicKeyPem: Type.String({ minLength: 160, maxLength: 2_048 }),
    metadata: WorkerRegistrationMetadataSchema,
  },
  { additionalProperties: false },
)
export type RegisterWorkerRequest = Type.Static<typeof RegisterWorkerRequestSchema>

export const RegisterWorkerResponseSchema = Type.Object(
  {
    workerId: Type.String({ format: 'uuid' }),
    credentialId: Type.String({ format: 'uuid' }),
    certificatePem: Type.String({ minLength: 256, maxLength: 16_384 }),
    caCertificatePem: Type.String({ minLength: 256, maxLength: 16_384 }),
    certificateSerial: Type.String({ minLength: 2, maxLength: 128 }),
    certificateFingerprintSha256: Type.String({ minLength: 64, maxLength: 95 }),
    certificateNotBefore: Type.String({ format: 'date-time' }),
    certificateExpiresAt: Type.String({ format: 'date-time' }),
    controlUrl: Type.String({ format: 'uri', minLength: 1, maxLength: 2_048 }),
  },
  { additionalProperties: false },
)
export type RegisterWorkerResponse = Type.Static<typeof RegisterWorkerResponseSchema>

export const WorkerDiagnosticProbeResponseSchema = Type.Object(
  {
    commandId: Type.String({ format: 'uuid' }),
    workerId: Type.String({ format: 'uuid' }),
    completedAt: Type.String({ format: 'date-time' }),
    report: WorkerCapabilityReportSchema,
  },
  { additionalProperties: false },
)
export type WorkerDiagnosticProbeResponse = Type.Static<typeof WorkerDiagnosticProbeResponseSchema>

export const WorkerStateSchema = Type.Enum([
  'PENDING',
  'ONLINE',
  'DRAINING',
  'OFFLINE',
  'DISABLED',
] as const)
export type WorkerState = Type.Static<typeof WorkerStateSchema>

export const SetWorkerStateRequestSchema = Type.Object(
  { state: Type.Enum(['ACTIVE', 'DRAINING', 'DISABLED'] as const) },
  { additionalProperties: false },
)
export type SetWorkerStateRequest = Type.Static<typeof SetWorkerStateRequestSchema>

export const WorkerStateResponseSchema = Type.Object(
  {
    workerId: Type.String({ format: 'uuid' }),
    state: WorkerStateSchema,
    controlConnected: Type.Boolean(),
    controlReady: Type.Boolean(),
    lastSeenAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    disabledAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type WorkerStateResponse = Type.Static<typeof WorkerStateResponseSchema>

export const WorkerCapacityStateSchema = Type.Enum([
  'AVAILABLE',
  'FULL',
  'OVER_LIMIT',
  'UNLIMITED',
] as const)
export type WorkerCapacityState = Type.Static<typeof WorkerCapacityStateSchema>

export const WorkerSchedulingBlockReasonSchema = Type.Enum([
  'STATE_NOT_ONLINE',
  'CONTROL_NOT_READY',
  'CAPACITY_REACHED',
  'STORAGE_BLOCKED',
] as const)
export type WorkerSchedulingBlockReason = Type.Static<typeof WorkerSchedulingBlockReasonSchema>

export const WorkerCapacitySummarySchema = Type.Object(
  {
    maxActiveTabs: Type.Union([Type.Integer({ minimum: 0, maximum: 1_000_000 }), Type.Null()]),
    activeTabs: Type.Integer({ minimum: 0 }),
    availableTabs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    state: WorkerCapacityStateSchema,
  },
  { additionalProperties: false },
)
export type WorkerCapacitySummary = Type.Static<typeof WorkerCapacitySummarySchema>

export const WorkerMetricsSnapshotResponseSchema = Type.Object(
  {
    observedAt: Type.String({ format: 'date-time' }),
    receivedAt: Type.String({ format: 'date-time' }),
    metrics: WorkerRuntimeMetricsSchema,
  },
  { additionalProperties: false },
)
export type WorkerMetricsSnapshotResponse = Type.Static<typeof WorkerMetricsSnapshotResponseSchema>

export const WorkerResponseSchema = Type.Object(
  {
    cleanupFailures: Type.Array(WorkerCleanupFailureSchema),
    storageQuotaBytes: StorageQuotaBytesSchema,
    storagePolicyVersion: Type.Integer({ minimum: 1 }),
    storageSnapshot: Type.Union([WorkerStorageFactSchema, Type.Null()]),
    storagePolicyPending: Type.Boolean(),
    id: Type.String({ format: 'uuid' }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    reportedHostname: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
    platform: Type.Union([Type.String({ minLength: 1, maxLength: 32 }), Type.Null()]),
    architecture: Type.Union([Type.String({ minLength: 1, maxLength: 32 }), Type.Null()]),
    state: WorkerStateSchema,
    controlConnected: Type.Boolean(),
    controlReady: Type.Boolean(),
    workerEligible: Type.Boolean(),
    schedulingBlockReasons: Type.Array(WorkerSchedulingBlockReasonSchema, {
      maxItems: 4,
      uniqueItems: true,
    }),
    capacity: WorkerCapacitySummarySchema,
    versions: Type.Record(
      Type.String({ minLength: 1, maxLength: 64 }),
      Type.String({ minLength: 1, maxLength: 128 }),
    ),
    capabilityReport: Type.Union([WorkerCapabilityReportSchema, Type.Null()]),
    metricsSnapshot: Type.Union([WorkerMetricsSnapshotResponseSchema, Type.Null()]),
    lastProbeErrorCode: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    lastProbeErrorSummary: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    lastSeenAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    lastSnapshotAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    disabledAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type WorkerResponse = Type.Static<typeof WorkerResponseSchema>

export const WorkerListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    state: Type.Optional(
      Type.Enum(['PENDING', 'ONLINE', 'DRAINING', 'OFFLINE', 'DISABLED', 'ALL'] as const),
    ),
  },
  { additionalProperties: false },
)
export type WorkerListQuery = Type.Static<typeof WorkerListQuerySchema>

export const WorkerListResponseSchema = Type.Object(
  {
    items: Type.Array(WorkerResponseSchema),
    meta: PaginationMetaSchema,
  },
  { additionalProperties: false },
)
export type WorkerListResponse = Type.Static<typeof WorkerListResponseSchema>

export const ProfileBusinessStatusSchema = Type.Enum(['ENABLED', 'DISABLED'] as const)
export type ProfileBusinessStatus = Type.Static<typeof ProfileBusinessStatusSchema>

export const ProfileRuntimeStateSchema = Type.Enum([
  'STOPPED',
  'STARTING',
  'RUNNING',
  'MAINTAINING',
  'STOPPING',
  'ERROR',
] as const)
export type ProfileRuntimeState = Type.Static<typeof ProfileRuntimeStateSchema>

export const ProfileRuntimeModeSchema = Type.Enum(['ALWAYS_ON', 'ON_DEMAND', 'MANUAL'] as const)
export type ProfileRuntimeMode = Type.Static<typeof ProfileRuntimeModeSchema>

export const ProfileVisibilitySchema = Type.Enum(['RESTRICTED', 'ALL_ENABLED_USERS'] as const)
export type ProfileVisibility = Type.Static<typeof ProfileVisibilitySchema>

export const ProfileCapacityStateSchema = Type.Enum([
  'AVAILABLE',
  'FULL',
  'OVER_LIMIT',
  'UNLIMITED',
] as const)
export type ProfileCapacityState = Type.Static<typeof ProfileCapacityStateSchema>

export const ProfileCapacitySummarySchema = Type.Object(
  {
    maxNormalSessions: Type.Union([Type.Integer({ minimum: 0, maximum: 1_000_000 }), Type.Null()]),
    activeSessions: Type.Integer({ minimum: 0 }),
    availableSessions: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    state: ProfileCapacityStateSchema,
  },
  { additionalProperties: false },
)
export type ProfileCapacitySummary = Type.Static<typeof ProfileCapacitySummarySchema>

export const ProfileWorkerSummarySchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    state: WorkerStateSchema,
  },
  { additionalProperties: false },
)
export type ProfileWorkerSummary = Type.Static<typeof ProfileWorkerSummarySchema>

export const ProfileGroupSummarySchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    status: ProfileBusinessStatusSchema,
    priority: Type.Integer(),
  },
  { additionalProperties: false },
)
export type ProfileGroupSummary = Type.Static<typeof ProfileGroupSummarySchema>

export const ProxyTypeSchema = Type.Enum(['DIRECT', 'HTTP', 'HTTPS', 'SOCKS5'] as const)
export type ProxyType = Type.Static<typeof ProxyTypeSchema>

export const ProxyHealthStatusSchema = Type.Enum(['UNKNOWN', 'HEALTHY', 'UNHEALTHY'] as const)
export type ProxyHealthStatus = Type.Static<typeof ProxyHealthStatusSchema>

export const ProfileProxySummarySchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    type: ProxyTypeSchema,
    healthStatus: ProxyHealthStatusSchema,
  },
  { additionalProperties: false },
)
export type ProfileProxySummary = Type.Static<typeof ProfileProxySummarySchema>

export const CreateProfileRequestSchema = Type.Object(
  {
    storageQuotaBytes: Type.Optional(StorageQuotaBytesSchema),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    description: Type.Union([Type.String({ maxLength: 4000 }), Type.Null()]),
    workerId: Type.String({ format: 'uuid' }),
    healthcheckUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
    proxyId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    visibility: ProfileVisibilitySchema,
    runtimeMode: ProfileRuntimeModeSchema,
    runtimeIdleTimeoutSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647 })),
    maxNormalSessions: Type.Union([Type.Integer({ minimum: 0, maximum: 1_000_000 }), Type.Null()]),
    tabAudioEnabled: Type.Boolean(),
    qualityPolicy: ProfileQualityPolicySchema,
    viewerFocusPolicy: Type.Optional(Type.Union([ViewerFocusPolicySchema, Type.Null()])),
  },
  { additionalProperties: false },
)
export type CreateProfileRequest = Type.Static<typeof CreateProfileRequestSchema>

export const UpdateProfileRequestSchema = Type.Object(
  {
    storageQuotaBytes: Type.Optional(StorageQuotaBytesSchema),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
    healthcheckUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
    proxyId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
    visibility: Type.Optional(ProfileVisibilitySchema),
    runtimeMode: Type.Optional(ProfileRuntimeModeSchema),
    runtimeIdleTimeoutSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647 })),
    maxNormalSessions: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 1_000_000 }), Type.Null()]),
    ),
    tabAudioEnabled: Type.Optional(Type.Boolean()),
    qualityPolicy: Type.Optional(ProfileQualityPolicySchema),
    viewerFocusPolicy: Type.Optional(Type.Union([ViewerFocusPolicySchema, Type.Null()])),
  },
  { additionalProperties: false, minProperties: 1 },
)
export type UpdateProfileRequest = Type.Static<typeof UpdateProfileRequestSchema>

export const SetProfileBusinessStateRequestSchema = Type.Object(
  { state: ProfileBusinessStatusSchema },
  { additionalProperties: false },
)
export type SetProfileBusinessStateRequest = Type.Static<
  typeof SetProfileBusinessStateRequestSchema
>

export const RequestProfileDeletionSchema = Type.Object(
  { expectedName: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
)
export type RequestProfileDeletion = Type.Static<typeof RequestProfileDeletionSchema>

export const ProfileResponseSchema = Type.Object(
  {
    runtimeRecovery: ProfileRuntimeRecoverySchema,
    ...ProfileRouteSummaryProperties,
    ...ProfileStorageSummaryProperties,
    id: Type.String({ format: 'uuid' }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    description: Type.Union([Type.String({ maxLength: 4000 }), Type.Null()]),
    worker: ProfileWorkerSummarySchema,
    proxy: Type.Union([ProfileProxySummarySchema, Type.Null()]),
    groups: Type.Array(ProfileGroupSummarySchema),
    visibility: ProfileVisibilitySchema,
    businessStatus: ProfileBusinessStatusSchema,
    runtimeState: ProfileRuntimeStateSchema,
    runtimeMode: ProfileRuntimeModeSchema,
    runtimeIdleTimeoutSeconds: Type.Integer({ minimum: 0 }),
    runtimeFailureCount: Type.Integer({ minimum: 0 }),
    runtimeRetryAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    runtimeGeneration: Type.Integer({ minimum: 0 }),
    healthcheckUrl: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
    runtimeErrorCode: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    runtimeErrorSummary: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    capacity: ProfileCapacitySummarySchema,
    tabAudioEnabled: Type.Boolean(),
    qualityPolicy: ProfileQualityPolicySchema,
    viewerFocusPolicy: Type.Union([ViewerFocusPolicySchema, Type.Null()]),
    deleteRequestedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type ProfileResponse = Type.Static<typeof ProfileResponseSchema>

export const ProfileRuntimeCountsSchema = Type.Object(
  {
    stopped: Type.Integer({ minimum: 0 }),
    starting: Type.Integer({ minimum: 0 }),
    running: Type.Integer({ minimum: 0 }),
    maintaining: Type.Integer({ minimum: 0 }),
    stopping: Type.Integer({ minimum: 0 }),
    error: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)
export type ProfileRuntimeCounts = Type.Static<typeof ProfileRuntimeCountsSchema>

export const ProfileListSummarySchema = Type.Object(
  {
    totalProfiles: Type.Integer({ minimum: 0 }),
    enabledProfiles: Type.Integer({ minimum: 0 }),
    disabledProfiles: Type.Integer({ minimum: 0 }),
    runtime: ProfileRuntimeCountsSchema,
    activeSessions: Type.Integer({ minimum: 0 }),
    finiteSessionLimit: Type.Integer({ minimum: 0 }),
    availableSessions: Type.Integer({ minimum: 0 }),
    unlimitedProfiles: Type.Integer({ minimum: 0 }),
    fullProfiles: Type.Integer({ minimum: 0 }),
    overLimitProfiles: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)
export type ProfileListSummary = Type.Static<typeof ProfileListSummarySchema>

export const ProfileListFacetsSchema = Type.Object(
  {
    workers: Type.Array(ProfileWorkerSummarySchema),
    groups: Type.Array(ProfileGroupSummarySchema),
    proxies: Type.Array(ProfileProxySummarySchema),
  },
  { additionalProperties: false },
)
export type ProfileListFacets = Type.Static<typeof ProfileListFacetsSchema>

export const ProfileListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    businessStatus: Type.Optional(Type.Enum(['ENABLED', 'DISABLED', 'ALL'] as const)),
    runtimeState: Type.Optional(
      Type.Enum([
        'STOPPED',
        'STARTING',
        'RUNNING',
        'MAINTAINING',
        'STOPPING',
        'ERROR',
        'ALL',
      ] as const),
    ),
    workerId: Type.Optional(Type.String({ format: 'uuid' })),
    groupId: Type.Optional(Type.String({ format: 'uuid' })),
  },
  { additionalProperties: false },
)
export type ProfileListQuery = Type.Static<typeof ProfileListQuerySchema>

export const ProfileListResponseSchema = Type.Object(
  {
    items: Type.Array(ProfileResponseSchema),
    meta: PaginationMetaSchema,
    summary: ProfileListSummarySchema,
    facets: ProfileListFacetsSchema,
  },
  { additionalProperties: false },
)
export type ProfileListResponse = Type.Static<typeof ProfileListResponseSchema>

export const ProxyCredentialsSchema = Type.Object(
  {
    readable: Type.Boolean(),
    hasUsername: Type.Boolean(),
    hasPassword: Type.Boolean(),
    username: Type.Union([Type.String(), Type.Null()]),
    password: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
)
export type ProxyCredentials = Type.Static<typeof ProxyCredentialsSchema>

export const ProxyResponseSchema = Type.Object(
  {
    configurationVersion: Type.Integer({ minimum: 1 }),
    lastProbeWorkerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    lastProbeMode: Type.Union([Type.Enum(['health', 'exit-ip'] as const), Type.Null()]),
    lastExitIp: Type.Union([Type.String({ maxLength: 45 }), Type.Null()]),
    id: Type.String({ format: 'uuid' }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    type: ProxyTypeSchema,
    host: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
    port: Type.Union([Type.Integer({ minimum: 1, maximum: 65_535 }), Type.Null()]),
    credentials: ProxyCredentialsSchema,
    healthcheckUrl: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
    healthStatus: ProxyHealthStatusSchema,
    lastCheckedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    lastSucceededAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    lastErrorSummary: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    assignedProfileCount: Type.Integer({ minimum: 0 }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type ProxyResponse = Type.Static<typeof ProxyResponseSchema>

export const ProxyListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    type: Type.Optional(Type.Union([ProxyTypeSchema, Type.Literal('ALL')])),
    healthStatus: Type.Optional(Type.Union([ProxyHealthStatusSchema, Type.Literal('ALL')])),
  },
  { additionalProperties: false },
)
export type ProxyListQuery = Type.Static<typeof ProxyListQuerySchema>

export const ProxyListResponseSchema = Type.Object(
  {
    items: Type.Array(ProxyResponseSchema),
    meta: PaginationMetaSchema,
  },
  { additionalProperties: false },
)
export type ProxyListResponse = Type.Static<typeof ProxyListResponseSchema>

export const CreateProxyRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 128 }),
    type: ProxyTypeSchema,
    host: Type.Optional(Type.Union([Type.String({ maxLength: 255 }), Type.Null()])),
    port: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 65_535 }), Type.Null()])),
    username: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),
    password: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),
    healthcheckUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
  },
  { additionalProperties: false },
)
export type CreateProxyRequest = Type.Static<typeof CreateProxyRequestSchema>

export const UpdateProxyRequestSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    type: Type.Optional(ProxyTypeSchema),
    host: Type.Optional(Type.Union([Type.String({ maxLength: 255 }), Type.Null()])),
    port: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 65_535 }), Type.Null()])),
    username: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),
    password: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),
    healthcheckUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
  },
  { additionalProperties: false, minProperties: 1 },
)
export type UpdateProxyRequest = Type.Static<typeof UpdateProxyRequestSchema>

export const UpdateWorkerCapacityRequestSchema = Type.Object(
  {
    storageQuotaBytes: Type.Optional(StorageQuotaBytesSchema),
    maxActiveTabs: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 1_000_000 }), Type.Null()]),
    ),
  },
  { additionalProperties: false, minProperties: 1 },
)
export type UpdateWorkerCapacityRequest = Type.Static<typeof UpdateWorkerCapacityRequestSchema>

export const WorkerCredentialStatusSchema = Type.Enum(['ACTIVE', 'REVOKED', 'EXPIRED'] as const)
export type WorkerCredentialStatus = Type.Static<typeof WorkerCredentialStatusSchema>

export const WorkerCredentialResponseSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    workerId: Type.String({ format: 'uuid' }),
    status: WorkerCredentialStatusSchema,
    certificateSerial: Type.String({ minLength: 2, maxLength: 128 }),
    certificateFingerprintSha256: Type.String({ minLength: 64, maxLength: 95 }),
    certificateNotBefore: Type.String({ format: 'date-time' }),
    certificateExpiresAt: Type.String({ format: 'date-time' }),
    currentConnection: Type.Boolean(),
    revokedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    revokeReason: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type WorkerCredentialResponse = Type.Static<typeof WorkerCredentialResponseSchema>

export const WorkerCredentialListResponseSchema = Type.Object(
  { items: Type.Array(WorkerCredentialResponseSchema) },
  { additionalProperties: false },
)
export type WorkerCredentialListResponse = Type.Static<typeof WorkerCredentialListResponseSchema>

export const WorkerCredentialRotationStatusSchema = Type.Enum([
  'ACTIVE',
  'CONSUMED',
  'REVOKED',
  'EXPIRED',
] as const)
export type WorkerCredentialRotationStatus = Type.Static<
  typeof WorkerCredentialRotationStatusSchema
>

export const WorkerCredentialRotationResponseSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    workerId: Type.String({ format: 'uuid' }),
    replacesCredentialId: Type.String({ format: 'uuid' }),
    issuedCredentialId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    status: WorkerCredentialRotationStatusSchema,
    expiresAt: Type.String({ format: 'date-time' }),
    consumedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    revokedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type WorkerCredentialRotationResponse = Type.Static<
  typeof WorkerCredentialRotationResponseSchema
>

export const IssuedWorkerCredentialRotationResponseSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    workerId: Type.String({ format: 'uuid' }),
    replacesCredentialId: Type.String({ format: 'uuid' }),
    issuedCredentialId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    status: WorkerCredentialRotationStatusSchema,
    expiresAt: Type.String({ format: 'date-time' }),
    consumedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    revokedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    token: Type.String({ minLength: 40, maxLength: 128 }),
  },
  { additionalProperties: false },
)
export type IssuedWorkerCredentialRotationResponse = Type.Static<
  typeof IssuedWorkerCredentialRotationResponseSchema
>

export const WorkerCredentialRotationListResponseSchema = Type.Object(
  { items: Type.Array(WorkerCredentialRotationResponseSchema) },
  { additionalProperties: false },
)
export type WorkerCredentialRotationListResponse = Type.Static<
  typeof WorkerCredentialRotationListResponseSchema
>

export const CreateWorkerCredentialRotationRequestSchema = Type.Object(
  { expiresInSeconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 86_400 })) },
  { additionalProperties: false },
)
export type CreateWorkerCredentialRotationRequest = Type.Static<
  typeof CreateWorkerCredentialRotationRequestSchema
>

export const RotateWorkerCredentialRequestSchema = Type.Object(
  {
    workerId: Type.String({ format: 'uuid' }),
    currentCredentialId: Type.String({ format: 'uuid' }),
    publicKeyPem: Type.String({ minLength: 160, maxLength: 2_048 }),
  },
  { additionalProperties: false },
)
export type RotateWorkerCredentialRequest = Type.Static<typeof RotateWorkerCredentialRequestSchema>

export const RotateWorkerCredentialResponseSchema = Type.Object(
  {
    workerId: Type.String({ format: 'uuid' }),
    credentialId: Type.String({ format: 'uuid' }),
    certificatePem: Type.String({ minLength: 256, maxLength: 16_384 }),
    caCertificatePem: Type.String({ minLength: 256, maxLength: 16_384 }),
    certificateSerial: Type.String({ minLength: 2, maxLength: 128 }),
    certificateFingerprintSha256: Type.String({ minLength: 64, maxLength: 95 }),
    certificateNotBefore: Type.String({ format: 'date-time' }),
    certificateExpiresAt: Type.String({ format: 'date-time' }),
    controlUrl: Type.String({ format: 'uri', minLength: 1, maxLength: 2_048 }),
  },
  { additionalProperties: false },
)
export type RotateWorkerCredentialResponse = Type.Static<
  typeof RotateWorkerCredentialResponseSchema
>

export const RevokeWorkerCredentialRequestSchema = Type.Object(
  { reason: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) },
  { additionalProperties: false },
)
export type RevokeWorkerCredentialRequest = Type.Static<typeof RevokeWorkerCredentialRequestSchema>

export const RetireWorkerRequestSchema = Type.Object(
  { expectedName: Type.String({ minLength: 1, maxLength: 128 }) },
  { additionalProperties: false },
)
export type RetireWorkerRequest = Type.Static<typeof RetireWorkerRequestSchema>

export const RetireWorkerResponseSchema = Type.Object(
  {
    workerId: Type.String({ format: 'uuid' }),
    retiredAt: Type.String({ format: 'date-time' }),
    revokedCredentialCount: Type.Integer({ minimum: 0 }),
    revokedRotationCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)
export type RetireWorkerResponse = Type.Static<typeof RetireWorkerResponseSchema>

export const UserStateSchema = Type.Enum(['ENABLED', 'DISABLED', 'DELETED'] as const)
export type UserState = Type.Static<typeof UserStateSchema>

export const UserResponseSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    email: Type.String({ minLength: 3, maxLength: 320 }),
    displayName: Type.String({ minLength: 1, maxLength: 128 }),
    state: UserStateSchema,
    maxActiveSessions: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    emailVerifiedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    roleIds: Type.Array(Type.String({ format: 'uuid' })),
    roleCodes: Type.Array(Type.String({ minLength: 1, maxLength: 64 })),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type UserResponse = Type.Static<typeof UserResponseSchema>

export const UserListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 320 })),
    state: Type.Optional(Type.Enum(['ENABLED', 'DISABLED', 'DELETED', 'ALL'] as const)),
  },
  { additionalProperties: false },
)
export type UserListQuery = Type.Static<typeof UserListQuerySchema>

export const UserListResponseSchema = Type.Object(
  {
    items: Type.Array(UserResponseSchema),
    meta: PaginationMetaSchema,
  },
  { additionalProperties: false },
)
export type UserListResponse = Type.Static<typeof UserListResponseSchema>

export const CreateUserRequestSchema = Type.Object(
  {
    email: Type.String({ minLength: 3, maxLength: 320 }),
    displayName: Type.String({ minLength: 1, maxLength: 128 }),
    password: Type.String({ minLength: 10, maxLength: 1024 }),
    maxActiveSessions: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 1_000_000 }), Type.Null()]),
    ),
    roleIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { uniqueItems: true })),
  },
  { additionalProperties: false },
)
export type CreateUserRequest = Type.Static<typeof CreateUserRequestSchema>

export const UpdateUserRequestSchema = Type.Object(
  {
    email: Type.Optional(Type.String({ minLength: 3, maxLength: 320 })),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    maxActiveSessions: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 1_000_000 }), Type.Null()]),
    ),
  },
  { additionalProperties: false, minProperties: 1 },
)
export type UpdateUserRequest = Type.Static<typeof UpdateUserRequestSchema>

export const SetUserStateRequestSchema = Type.Object(
  { state: Type.Enum(['ENABLED', 'DISABLED'] as const) },
  { additionalProperties: false },
)
export type SetUserStateRequest = Type.Static<typeof SetUserStateRequestSchema>

export const SetUserRolesRequestSchema = Type.Object(
  { roleIds: Type.Array(Type.String({ format: 'uuid' }), { uniqueItems: true }) },
  { additionalProperties: false },
)
export type SetUserRolesRequest = Type.Static<typeof SetUserRolesRequestSchema>

export const RoleResponseSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    code: Type.String({ minLength: 1, maxLength: 64 }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    description: Type.Union([Type.String(), Type.Null()]),
    isSystem: Type.Boolean(),
    permissions: Type.Array(Type.String({ minLength: 1, maxLength: 96 })),
  },
  { additionalProperties: false },
)
export type RoleResponse = Type.Static<typeof RoleResponseSchema>

export const RoleListResponseSchema = Type.Object(
  { items: Type.Array(RoleResponseSchema) },
  { additionalProperties: false },
)
export type RoleListResponse = Type.Static<typeof RoleListResponseSchema>

export const SetProfileRuntimeRequestSchema = Type.Union([
  Type.Object({ action: Type.Literal('START') }, { additionalProperties: false }),
  Type.Object(
    { action: Type.Literal('STOP'), closeSessions: Type.Optional(Type.Boolean()) },
    { additionalProperties: false },
  ),
])
export type SetProfileRuntimeRequest = Type.Static<typeof SetProfileRuntimeRequestSchema>

export const ProfileGroupResponseSchema = Type.Object(
  {
    ...ProfileGroupSummarySchema.properties,
    description: Type.Union([Type.String(), Type.Null()]),
    profileCount: Type.Integer({ minimum: 0 }),
    userCount: Type.Integer({ minimum: 0 }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type ProfileGroupResponse = Type.Static<typeof ProfileGroupResponseSchema>
export const CreateProfileGroupRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 128 }),
    description: Type.Union([Type.String({ maxLength: 4000 }), Type.Null()]),
    priority: Type.Integer({ minimum: -2147483648, maximum: 2147483647 }),
  },
  { additionalProperties: false },
)
export type CreateProfileGroupRequest = Type.Static<typeof CreateProfileGroupRequestSchema>
export const UpdateProfileGroupRequestSchema = Type.Partial(CreateProfileGroupRequestSchema, {
  minProperties: 1,
  additionalProperties: false,
})
export type UpdateProfileGroupRequest = Type.Static<typeof UpdateProfileGroupRequestSchema>
export const ProfileGroupListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    search: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    status: Type.Optional(Type.Enum(['ENABLED', 'DISABLED', 'ALL'] as const)),
  },
  { additionalProperties: false },
)
export type ProfileGroupListQuery = Type.Static<typeof ProfileGroupListQuerySchema>
export const ProfileGroupListResponseSchema = Type.Object(
  { items: Type.Array(ProfileGroupResponseSchema), meta: PaginationMetaSchema },
  { additionalProperties: false },
)
export type ProfileGroupListResponse = Type.Static<typeof ProfileGroupListResponseSchema>
export const ProfileAccessSubjectSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    status: ProfileBusinessStatusSchema,
  },
  { additionalProperties: false },
)
export type ProfileAccessSubject = Type.Static<typeof ProfileAccessSubjectSchema>
export const ProfileGroupMembersResponseSchema = Type.Object(
  {
    profiles: Type.Array(ProfileAccessSubjectSchema),
    users: Type.Array(ProfileAccessSubjectSchema),
  },
  { additionalProperties: false },
)
export type ProfileGroupMembersResponse = Type.Static<typeof ProfileGroupMembersResponseSchema>
export const SetProfileGroupMembersRequestSchema = Type.Object(
  {
    profileIds: Type.Array(Type.String({ format: 'uuid' }), { uniqueItems: true }),
    userIds: Type.Array(Type.String({ format: 'uuid' }), { uniqueItems: true }),
  },
  { additionalProperties: false },
)
export type SetProfileGroupMembersRequest = Type.Static<typeof SetProfileGroupMembersRequestSchema>
export const ProfileGrantsResponseSchema = Type.Object(
  { users: Type.Array(ProfileAccessSubjectSchema) },
  { additionalProperties: false },
)
export type ProfileGrantsResponse = Type.Static<typeof ProfileGrantsResponseSchema>
export const SetProfileGrantsRequestSchema = Type.Object(
  { userIds: Type.Array(Type.String({ format: 'uuid' }), { uniqueItems: true }) },
  { additionalProperties: false },
)
export type SetProfileGrantsRequest = Type.Static<typeof SetProfileGrantsRequestSchema>
export const ProfileSubjectQuerySchema = Type.Object(
  {
    ...ProfileGroupListQuerySchema.properties,
    kind: Type.Enum(['USER', 'PROFILE'] as const),
  },
  { additionalProperties: false },
)
export type ProfileSubjectQuery = Type.Static<typeof ProfileSubjectQuerySchema>
export const ProfileSubjectListResponseSchema = Type.Object(
  { items: Type.Array(ProfileAccessSubjectSchema), meta: PaginationMetaSchema },
  { additionalProperties: false },
)
export type ProfileSubjectListResponse = Type.Static<typeof ProfileSubjectListResponseSchema>

export const AccessibleProfileSchema = Type.Object(
  {
    ...ProfileRouteSummaryProperties,
    ...ProfileStorageSummaryProperties,
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    runtimeState: ProfileRuntimeStateSchema,
    runtimeMode: ProfileRuntimeModeSchema,
    groups: Type.Array(ProfileGroupSummarySchema),
    capacity: ProfileCapacitySummarySchema,
  },
  { additionalProperties: false },
)
export type AccessibleProfile = Type.Static<typeof AccessibleProfileSchema>
export const AccessibleProfileListResponseSchema = Type.Object(
  { items: Type.Array(AccessibleProfileSchema), meta: PaginationMetaSchema },
  { additionalProperties: false },
)
export type AccessibleProfileListResponse = Type.Static<typeof AccessibleProfileListResponseSchema>

export const SessionPolicyScopeSchema = Type.Enum([
  'GLOBAL',
  'USER_PROFILE',
  'USER_PROFILE_GROUP',
] as const)
export const SaveSessionPolicyRequestSchema = Type.Object(
  {
    scope: SessionPolicyScopeSchema,
    userId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    profileId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    profileGroupId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    values: SessionPolicyValuesSchema,
  },
  { additionalProperties: false },
)
export type SaveSessionPolicyRequest = Type.Static<typeof SaveSessionPolicyRequestSchema>
export const SessionPolicyResponseSchema = Type.Object(
  {
    ...SaveSessionPolicyRequestSchema.properties,
    id: Type.String({ format: 'uuid' }),
    userName: Type.Union([Type.String(), Type.Null()]),
    profileName: Type.Union([Type.String(), Type.Null()]),
    profileGroupName: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type SessionPolicyResponse = Type.Static<typeof SessionPolicyResponseSchema>
export const SessionPolicyListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    scope: Type.Optional(SessionPolicyScopeSchema),
    userId: Type.Optional(Type.String({ format: 'uuid' })),
    profileId: Type.Optional(Type.String({ format: 'uuid' })),
    profileGroupId: Type.Optional(Type.String({ format: 'uuid' })),
  },
  { additionalProperties: false },
)
export type SessionPolicyListQuery = Type.Static<typeof SessionPolicyListQuerySchema>
export const SessionPolicyListResponseSchema = Type.Object(
  {
    items: Type.Array(SessionPolicyResponseSchema),
    meta: PaginationMetaSchema,
  },
  { additionalProperties: false },
)
export const SessionPolicyPreviewQuerySchema = Type.Object(
  {
    userId: Type.String({ format: 'uuid' }),
    profileId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
)
export type SessionPolicyPreviewQuery = Type.Static<typeof SessionPolicyPreviewQuerySchema>
export const ResolvedSessionPolicySchema = Type.Object(
  {
    scope: SessionPolicyScopeSchema,
    policyId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    profileGroupId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    priority: Type.Union([Type.Integer(), Type.Null()]),
    values: SessionPolicyValuesSchema,
  },
  { additionalProperties: false },
)
export type ResolvedSessionPolicy = Type.Static<typeof ResolvedSessionPolicySchema>
export const SessionPolicyPreviewSchema = Type.Object(
  {
    ...SessionPolicyPreviewQuerySchema.properties,
    accessible: Type.Boolean(),
    resolved: ResolvedSessionPolicySchema,
  },
  { additionalProperties: false },
)
export * from './session-creation.js'

export const SessionContinueRequestSchema = Type.Object(
  {
    clientId: Type.String({ minLength: 1, maxLength: 256 }),
    viewerGeneration: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
  },
  { additionalProperties: false },
)
export type SessionContinueRequest = Type.Static<typeof SessionContinueRequestSchema>
export const SessionContinueResponseSchema = Type.Object(
  {
    recycling: Type.Union([SessionRecycleStateSchema, Type.Null()]),
    serverTime: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type SessionContinueResponse = Type.Static<typeof SessionContinueResponseSchema>

export * from './page-scripts.js'

export const MaintenanceBlockReasonSchema = Type.Enum([
  'PROFILE_MAINTENANCE_ACTIVE',
  'PROFILE_DISABLED',
  'PROFILE_NOT_READY',
  'PROFILE_HEALTHCHECK_REQUIRED',
  'WORKER_UNAVAILABLE',
  'WORKER_PROTOCOL_INCOMPATIBLE',
] as const)
export const MaintenanceProfileSchema = Type.Object(
  {
    ...ProfileRouteSummaryProperties,
    ...ProfileStorageSummaryProperties,
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    businessStatus: ProfileResponseSchema.properties.businessStatus,
    runtimeState: ProfileResponseSchema.properties.runtimeState,
    runtimeMode: ProfileResponseSchema.properties.runtimeMode,
    defaultInitialUrl: Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
    activeNormalSessions: Type.Integer({ minimum: 0 }),
    blockedReason: Type.Union([MaintenanceBlockReasonSchema, Type.Null()]),
    maintenance: Type.Union([
      Type.Object(
        {
          sessionId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
          ownerName: Type.String(),
          status: TabSessionStatusSchema,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type MaintenanceProfile = Type.Static<typeof MaintenanceProfileSchema>
export const MaintenanceProfileListQuerySchema = Type.Object(
  {
    ...PageQuerySchema.properties,
    search: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
)
export type MaintenanceProfileListQuery = Type.Static<typeof MaintenanceProfileListQuerySchema>
export const MaintenanceProfileListResponseSchema = Type.Object(
  {
    items: Type.Array(MaintenanceProfileSchema),
    meta: PaginationMetaSchema,
  },
  { additionalProperties: false },
)

export const AuditResultSchema = Type.Enum(['SUCCEEDED', 'FAILED', 'DENIED'] as const)
export const AuditEventSummarySchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    actorUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    actorName: Type.Union([Type.String(), Type.Null()]),
    action: Type.String(),
    targetType: Type.String(),
    targetId: Type.Union([Type.String(), Type.Null()]),
    result: AuditResultSchema,
    occurredAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export const AuditEventSchema = Type.Object(
  {
    ...AuditEventSummarySchema.properties,
    requestId: Type.Union([Type.String(), Type.Null()]),
    sourceIpHash: Type.Union([Type.String(), Type.Null()]),
    changes: Type.Record(Type.String(), Type.Unknown()),
    metadata: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
)
export type AuditEvent = Type.Static<typeof AuditEventSchema>
export const AuditEventListQuerySchema = Type.Object(
  {
    ...PageQuerySchema.properties,
    actorUserId: Type.Optional(Type.String({ format: 'uuid' })),
    withoutActor: Type.Optional(Type.Boolean()),
    action: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z][a-z0-9_.:-]*$' }),
    ),
    targetType: Type.Optional(
      Type.String({ minLength: 1, maxLength: 96, pattern: '^[a-z][a-z0-9_.:-]*$' }),
    ),
    targetId: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    result: Type.Optional(AuditResultSchema),
    from: Type.Optional(Type.String({ format: 'date-time' })),
    to: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { additionalProperties: false },
)
export type AuditEventListQuery = Type.Static<typeof AuditEventListQuerySchema>
export const AuditEventListResponseSchema = Type.Object(
  {
    items: Type.Array(AuditEventSummarySchema),
    meta: PaginationMetaSchema,
  },
  { additionalProperties: false },
)
export type AuditEventListResponse = Type.Static<typeof AuditEventListResponseSchema>

export const WorkerOverviewSchema = Type.Object(
  {
    storage: Type.Object(
      {
        lowDiskWorkers: Type.Integer({ minimum: 0 }),
        criticalDiskWorkers: Type.Integer({ minimum: 0 }),
        quotaExceededWorkers: Type.Integer({ minimum: 0 }),
        unknownWorkers: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    totalWorkers: Type.Integer({ minimum: 0 }),
    states: Type.Object(
      {
        pending: Type.Integer({ minimum: 0 }),
        online: Type.Integer({ minimum: 0 }),
        draining: Type.Integer({ minimum: 0 }),
        offline: Type.Integer({ minimum: 0 }),
        disabled: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    connectedWorkers: Type.Integer({ minimum: 0 }),
    readyWorkers: Type.Integer({ minimum: 0 }),
    eligibleWorkers: Type.Integer({ minimum: 0 }),
    capacity: Type.Object(
      {
        activeTabs: Type.Integer({ minimum: 0 }),
        finiteTabLimit: Type.Integer({ minimum: 0 }),
        availableTabs: Type.Integer({ minimum: 0 }),
        unlimitedWorkers: Type.Integer({ minimum: 0 }),
        fullWorkers: Type.Integer({ minimum: 0 }),
        overLimitWorkers: Type.Integer({ minimum: 0 }),
        schedulableAvailableTabs: Type.Integer({ minimum: 0 }),
        schedulableUnlimitedWorkers: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerOverview = Type.Static<typeof WorkerOverviewSchema>

export const ProfileOverviewSchema = Type.Object(
  {
    ...ProfileListSummarySchema.properties,
    storageQuotaExceededProfiles: Type.Integer({ minimum: 0 }),
    storageUnknownProfiles: Type.Integer({ minimum: 0 }),
    deletingProfiles: Type.Integer({ minimum: 0 }),
    restartRequiredProfiles: Type.Integer({ minimum: 0 }),
    unhealthyRuntimes: Type.Integer({ minimum: 0 }),
    unknownRuntimeHealth: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)
export type ProfileOverview = Type.Static<typeof ProfileOverviewSchema>

export const SessionOverviewSchema = Type.Object(
  {
    activeSessions: Type.Integer({ minimum: 0 }),
    normalSessions: Type.Integer({ minimum: 0 }),
    maintenanceSessions: Type.Integer({ minimum: 0 }),
    states: Type.Object(
      {
        reserved: Type.Integer({ minimum: 0 }),
        creating: Type.Integer({ minimum: 0 }),
        ready: Type.Integer({ minimum: 0 }),
        connected: Type.Integer({ minimum: 0 }),
        suspended: Type.Integer({ minimum: 0 }),
        disconnected: Type.Integer({ minimum: 0 }),
        closing: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type SessionOverview = Type.Static<typeof SessionOverviewSchema>

export const AdminOverviewSchema = Type.Object(
  {
    observedAt: Type.String({ format: 'date-time' }),
    workers: Type.Union([WorkerOverviewSchema, Type.Null()]),
    profiles: Type.Union([ProfileOverviewSchema, Type.Null()]),
    sessions: Type.Union([SessionOverviewSchema, Type.Null()]),
    unavailableReasons: Type.Object(
      {
        workers: Type.Union([Type.Literal('MISSING_WORKER_READ'), Type.Null()]),
        profiles: Type.Union([Type.Literal('MISSING_PROFILE_READ'), Type.Null()]),
        sessions: Type.Union([Type.Literal('MISSING_PROFILE_READ'), Type.Null()]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type AdminOverview = Type.Static<typeof AdminOverviewSchema>
