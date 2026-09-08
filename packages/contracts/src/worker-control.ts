import {
  StoragePolicySchema,
  ProfileStoragePolicySchema,
  WorkerStorageFactSchema,
  ProfileStorageUsageSchema,
} from './storage.js'
import { assertProfileContextVariables } from './profile-contexts.js'
import { WorkerCleanupErrorSchema } from './worker-recovery.js'
import {
  RuntimeProxyHealthSchema,
  ProxyProbeModeSchema,
  ProxyProbeResultSchema,
} from './proxy-runtime.js'
import { SessionTransferSettingsSchema } from './system-settings.js'
import { RetainedDownloadSchema } from './downloads.js'
import { ProfileQualityPolicySchema } from './media-policy.js'
import { decode, encode } from '@msgpack/msgpack'
import Type from 'typebox'
import { Value } from 'typebox/value'
import { SessionNavigationPolicySchema, SessionPageScriptSchema } from './session-creation.js'
import { SessionViewerTicketSchema } from './gateway-control.js'
import { SessionPolicyValuesSchema, SessionRecycleStateSchema } from './session-policy.js'

export const WORKER_CONTROL_PROTOCOL_MAJOR = 1 as const
export const WORKER_CONTROL_PROTOCOL_MINOR = 22 as const
export const WORKER_CONTROL_MAX_MESSAGE_BYTES = 256 * 1024

const MessageIdSchema = Type.String({ format: 'uuid' })
const SentAtSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const ByteCountSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
const NullableByteCountSchema = Type.Union([ByteCountSchema, Type.Null()])

export const WORKER_REQUIRED_PROBE_CHECK_NAMES = [
  'HOST_PLATFORM',
  'IDENTITY_STORAGE',
  'PROFILE_STORAGE',
  'TEMPORARY_STORAGE',
  'CHROME_BINARY',
  'CHROME_VERSION',
  'CHROME_SANDBOX',
  'CDP_LOOPBACK',
  'EXTENSION_POLICY',
  'EXTENSION_VERSION',
  'TAB_CAPTURE',
  'EXTENSION_LOOPBACK',
  'WEBRTC',
  'REMOTE_TAB_CORE',
  'PROXY_ADAPTER',
] as const
export const WorkerProbeCheckNameSchema = Type.Enum(WORKER_REQUIRED_PROBE_CHECK_NAMES)
export type WorkerProbeCheckName = Type.Static<typeof WorkerProbeCheckNameSchema>

export const WorkerProbeCheckStatusSchema = Type.Enum(['PASS', 'FAIL', 'NOT_RUN'] as const)
export type WorkerProbeCheckStatus = Type.Static<typeof WorkerProbeCheckStatusSchema>

export const WorkerProbeCheckSchema = Type.Object(
  {
    name: WorkerProbeCheckNameSchema,
    status: WorkerProbeCheckStatusSchema,
    code: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    summary: Type.Union([Type.String({ minLength: 1, maxLength: 512 }), Type.Null()]),
    guidance: Type.Union([Type.String({ minLength: 1, maxLength: 1_024 }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type WorkerProbeCheck = Type.Static<typeof WorkerProbeCheckSchema>

export const WorkerStorageSnapshotSchema = Type.Object(
  {
    purpose: Type.Enum(['identity', 'profiles', 'temporary'] as const),
    totalBytes: ByteCountSchema,
    availableBytes: ByteCountSchema,
    totalInodes: NullableByteCountSchema,
    availableInodes: NullableByteCountSchema,
  },
  { additionalProperties: false },
)
export type WorkerStorageSnapshot = Type.Static<typeof WorkerStorageSnapshotSchema>

export const WorkerVersionsSchema = Type.Object(
  {
    worker: Type.String({ minLength: 1, maxLength: 64 }),
    controlProtocol: Type.String({ minLength: 1, maxLength: 32 }),
    node: Type.String({ minLength: 1, maxLength: 64 }),
    chrome: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    remoteTabCore: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    extension: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type WorkerVersions = Type.Static<typeof WorkerVersionsSchema>

export const WorkerCapabilityReportSchema = Type.Object(
  {
    status: Type.Enum(['READY', 'FAILED'] as const),
    completedAt: Type.String({ format: 'date-time' }),
    host: Type.Object(
      {
        hostname: Type.String({ minLength: 1, maxLength: 255 }),
        platform: Type.String({ minLength: 1, maxLength: 32 }),
        architecture: Type.String({ minLength: 1, maxLength: 32 }),
        logicalCpuCount: Type.Integer({ minimum: 1, maximum: 65_536 }),
        totalMemoryBytes: ByteCountSchema,
      },
      { additionalProperties: false },
    ),
    versions: WorkerVersionsSchema,
    checks: Type.Array(WorkerProbeCheckSchema, { minItems: 1, maxItems: 32 }),
    supportedCapabilities: Type.Array(Type.String({ minLength: 1, maxLength: 96 }), {
      maxItems: 128,
      uniqueItems: true,
    }),
    storage: Type.Array(WorkerStorageSnapshotSchema, { minItems: 1, maxItems: 3 }),
  },
  { additionalProperties: false },
)
export type WorkerCapabilityReport = Type.Static<typeof WorkerCapabilityReportSchema>

export const WorkerRuntimeMetricsSchema = Type.Object(
  {
    cpu: Type.Object(
      {
        logicalCpuCount: Type.Integer({ minimum: 1, maximum: 65_536 }),
        utilizationPercent: Type.Number({ minimum: 0, maximum: 100 }),
        loadAverage1: Type.Number({ minimum: 0 }),
        loadAverage5: Type.Number({ minimum: 0 }),
        loadAverage15: Type.Number({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    memory: Type.Object(
      {
        totalBytes: ByteCountSchema,
        availableBytes: ByteCountSchema,
        workerRssBytes: ByteCountSchema,
      },
      { additionalProperties: false },
    ),
    storage: Type.Array(WorkerStorageSnapshotSchema, { minItems: 1, maxItems: 3 }),
    runtime: Type.Object(
      {
        chromeInstances: Type.Integer({ minimum: 0, maximum: 100_000 }),
        tabs: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
        activeSessions: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
      },
      { additionalProperties: false },
    ),
    network: Type.Object(
      {
        receivedBytes: NullableByteCountSchema,
        transmittedBytes: NullableByteCountSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerRuntimeMetrics = Type.Static<typeof WorkerRuntimeMetricsSchema>

export const WorkerHelloMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('worker.hello'),
    messageId: MessageIdSchema,
    correlationId: Type.Null(),
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        credentialId: Type.String({ format: 'uuid' }),
        downloadEndpoint: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
        instanceId: Type.Optional(Type.String({ format: 'uuid' })),
        workerVersion: Type.String({ minLength: 1, maxLength: 64 }),
        hostname: Type.String({ minLength: 1, maxLength: 255 }),
        platform: Type.String({ minLength: 1, maxLength: 32 }),
        architecture: Type.String({ minLength: 1, maxLength: 32 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerHelloMessage = Type.Static<typeof WorkerHelloMessageSchema>

export const WorkerHelloAcceptedMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('worker.hello.accepted'),
    messageId: MessageIdSchema,
    correlationId: MessageIdSchema,
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        serverTime: Type.String({ format: 'date-time' }),
        negotiatedProtocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
        heartbeatIntervalMilliseconds: Type.Integer({ minimum: 1_000, maximum: 300_000 }),
        snapshotRequired: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerHelloAcceptedMessage = Type.Static<typeof WorkerHelloAcceptedMessageSchema>

export const WorkerCapabilitiesMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('worker.capabilities'),
    messageId: MessageIdSchema,
    correlationId: Type.Null(),
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        report: WorkerCapabilityReportSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerCapabilitiesMessage = Type.Static<typeof WorkerCapabilitiesMessageSchema>

export const WorkerCapabilitiesAcceptedMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('worker.capabilities.accepted'),
    messageId: MessageIdSchema,
    correlationId: MessageIdSchema,
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        acceptedAt: Type.String({ format: 'date-time' }),
        workerReady: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerCapabilitiesAcceptedMessage = Type.Static<
  typeof WorkerCapabilitiesAcceptedMessageSchema
>

export const WorkerHeartbeatMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('worker.heartbeat'),
    messageId: MessageIdSchema,
    correlationId: Type.Null(),
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        observedAt: Type.String({ format: 'date-time' }),
        metrics: WorkerRuntimeMetricsSchema,
        storage: Type.Optional(WorkerStorageFactSchema),
        profileStorageUsage: Type.Optional(
          Type.Array(ProfileStorageUsageSchema, { maxItems: 100 }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerHeartbeatMessage = Type.Static<typeof WorkerHeartbeatMessageSchema>

export const WORKER_DOWNLOAD_BATCH_SIZE = 100 as const
export const WorkerDownloadsMessageSchema = Type.Object(
  {
    ...WorkerHeartbeatMessageSchema.properties,
    protocolMinor: Type.Integer({ minimum: 16, maximum: 65_535 }),
    type: Type.Literal('worker.downloads'),
    payload: Type.Object(
      {
        workerId: MessageIdSchema,
        instanceId: MessageIdSchema,
        downloads: Type.Array(RetainedDownloadSchema, {
          minItems: 1,
          maxItems: WORKER_DOWNLOAD_BATCH_SIZE,
        }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerDownloadsMessage = Type.Static<typeof WorkerDownloadsMessageSchema>

export const WorkerDownloadsAcceptedMessageSchema = Type.Object(
  {
    ...WorkerDownloadsMessageSchema.properties,
    type: Type.Literal('worker.downloads.accepted'),
    correlationId: MessageIdSchema,
    payload: Type.Object(
      {
        workerId: MessageIdSchema,
        instanceId: MessageIdSchema,
        terminalIds: Type.Array(MessageIdSchema, { maxItems: WORKER_DOWNLOAD_BATCH_SIZE }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerDownloadsAcceptedMessage = Type.Static<
  typeof WorkerDownloadsAcceptedMessageSchema
>

export const WorkerHeartbeatAcknowledgedMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('worker.heartbeat.ack'),
    messageId: MessageIdSchema,
    correlationId: MessageIdSchema,
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        receivedAt: Type.String({ format: 'date-time' }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerHeartbeatAcknowledgedMessage = Type.Static<
  typeof WorkerHeartbeatAcknowledgedMessageSchema
>

export const WorkerProfileRuntimeFactSchema = Type.Object(
  {
    cleanupError: Type.Optional(WorkerCleanupErrorSchema),
    profileId: Type.String({ format: 'uuid' }),
    runtimeId: Type.String({ format: 'uuid' }),
    generation: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    state: Type.Enum(['STARTING', 'RUNNING', 'MAINTAINING', 'STOPPING', 'ERROR'] as const),
    storageUsage: Type.Optional(ProfileStorageUsageSchema),
    routeVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    proxyHealth: Type.Optional(Type.Union([RuntimeProxyHealthSchema, Type.Null()])),
    chromeProcessId: Type.Union([
      Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
      Type.Null(),
    ]),
    startedAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type WorkerProfileRuntimeFact = Type.Static<typeof WorkerProfileRuntimeFactSchema>

export const WorkerPageScriptErrorSchema = Type.Object(
  {
    code: Type.Literal('PAGE_SCRIPT_FAILED'),
    versionId: Type.String({ format: 'uuid' }),
    occurredAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type WorkerPageScriptError = Type.Static<typeof WorkerPageScriptErrorSchema>

export const WorkerSessionRuntimeFactSchema = Type.Object(
  {
    cleanupError: Type.Optional(WorkerCleanupErrorSchema),
    pageScriptError: Type.Optional(WorkerPageScriptErrorSchema),
    sessionId: Type.String({ format: 'uuid' }),
    profileId: Type.String({ format: 'uuid' }),
    runtimeId: Type.String({ format: 'uuid' }),
    profileGeneration: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    status: Type.Enum([
      'CREATING',
      'READY',
      'CONNECTED',
      'SUSPENDED',
      'DISCONNECTED',
      'CLOSING',
    ] as const),
    tabId: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    targetId: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
    viewerGeneration: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    leaseExpiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    remoteTitle: Type.Union([Type.String({ maxLength: 4_096 }), Type.Null()]),
    lastInputAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastFrameChangedAt: Type.Optional(Type.String({ format: 'date-time' })),
    recycling: Type.Optional(Type.Union([SessionRecycleStateSchema, Type.Null()])),
  },
  { additionalProperties: false },
)
export type WorkerSessionRuntimeFact = Type.Static<typeof WorkerSessionRuntimeFactSchema>

export const WorkerSessionClosedFactSchema = Type.Object(
  {
    pageScriptError: Type.Optional(WorkerPageScriptErrorSchema),
    sessionId: Type.String({ format: 'uuid' }),
    profileId: Type.String({ format: 'uuid' }),
    runtimeId: Type.String({ format: 'uuid' }),
    profileGeneration: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    tabId: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    targetId: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
    closedAt: Type.String({ format: 'date-time' }),
    reason: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
)
export type WorkerSessionClosedFact = Type.Static<typeof WorkerSessionClosedFactSchema>

export const WorkerRuntimeSnapshotSchema = Type.Object(
  {
    instanceId: Type.String({ format: 'uuid' }),
    sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    observedAt: Type.String({ format: 'date-time' }),
    storage: Type.Optional(WorkerStorageFactSchema),
    profileStorageUsage: Type.Optional(Type.Array(ProfileStorageUsageSchema, { maxItems: 100 })),
    profiles: Type.Array(WorkerProfileRuntimeFactSchema, { maxItems: 2_048 }),
    sessions: Type.Array(WorkerSessionRuntimeFactSchema, { maxItems: 8_192 }),
    closedSessions: Type.Optional(Type.Array(WorkerSessionClosedFactSchema, { maxItems: 8_192 })),
  },
  { additionalProperties: false },
)
export type WorkerRuntimeSnapshot = Type.Static<typeof WorkerRuntimeSnapshotSchema>

export const WorkerSnapshotMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('worker.snapshot'),
    messageId: MessageIdSchema,
    correlationId: Type.Null(),
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        snapshot: WorkerRuntimeSnapshotSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerSnapshotMessage = Type.Static<typeof WorkerSnapshotMessageSchema>

export const WorkerSessionReconciliationReasonSchema = Type.Enum([
  'BACKEND_SESSION_MISSING',
  'BACKEND_SESSION_TERMINAL',
  'BACKEND_SESSION_CLOSING',
  'LEASE_EXPIRED',
  'MAPPING_CONFLICT',
] as const)
export const WorkerProfileReconciliationReasonSchema = Type.Enum([
  'BACKEND_PROFILE_MISSING',
  'BACKEND_PROFILE_STOPPED',
  'GENERATION_MISMATCH',
] as const)

export const WorkerSnapshotAcceptedMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('worker.snapshot.accepted'),
    messageId: MessageIdSchema,
    correlationId: MessageIdSchema,
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        instanceId: Type.String({ format: 'uuid' }),
        sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        acceptedAt: Type.String({ format: 'date-time' }),
        leases: Type.Optional(
          Type.Array(
            Type.Object(
              {
                sessionId: Type.String({ format: 'uuid' }),
                profileId: Type.String({ format: 'uuid' }),
                runtimeId: Type.String({ format: 'uuid' }),
                profileGeneration: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
                tabId: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
                targetId: Type.String({ minLength: 1, maxLength: 128 }),
                expiresAt: Type.String({ format: 'date-time' }),
              },
              { additionalProperties: false },
            ),
            { maxItems: 8192 },
          ),
        ),
        closeSessions: Type.Array(
          Type.Object(
            {
              sessionId: Type.String({ format: 'uuid' }),
              reason: WorkerSessionReconciliationReasonSchema,
            },
            { additionalProperties: false },
          ),
          { maxItems: 8_192 },
        ),
        stopProfiles: Type.Array(
          Type.Object(
            {
              profileId: Type.String({ format: 'uuid' }),
              runtimeId: Type.String({ format: 'uuid' }),
              generation: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
              reason: WorkerProfileReconciliationReasonSchema,
            },
            { additionalProperties: false },
          ),
          { maxItems: 2_048 },
        ),
        resnapshotRequired: Type.Boolean(),
        closedSessionIds: Type.Optional(
          Type.Array(Type.String({ format: 'uuid' }), { maxItems: 8_192 }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerSnapshotAcceptedMessage = Type.Static<typeof WorkerSnapshotAcceptedMessageSchema>

export const WorkerCommandTypeSchema = Type.Enum([
  'diagnostic.probe',
  'proxy.probe',
  'storage.policy.set',
  'profile.runtime.set',
  'session.close',
  'session.create',
  'session.viewer.prepare',
  'session.continue',
] as const)
export type WorkerCommandType = Type.Static<typeof WorkerCommandTypeSchema>

export const WorkerDiagnosticProbeCommandMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('diagnostic.probe'),
    messageId: MessageIdSchema,
    correlationId: Type.Null(),
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        expiresAt: Type.String({ format: 'date-time' }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerDiagnosticProbeCommandMessage = Type.Static<
  typeof WorkerDiagnosticProbeCommandMessageSchema
>

export const WorkerProfileProxySchema = Type.Union([
  Type.Object({ type: Type.Literal('DIRECT') }, { additionalProperties: false }),
  Type.Object(
    {
      type: Type.Enum(['HTTP', 'HTTPS', 'SOCKS5'] as const),
      host: Type.String({ minLength: 1, maxLength: 255 }),
      port: Type.Integer({ minimum: 1, maximum: 65535 }),
      username: Type.Union([Type.String({ maxLength: 1024 }), Type.Null()]),
      password: Type.Union([Type.String({ maxLength: 1024 }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
])

export const WorkerProxyProbeCommandMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
    protocolMinor: Type.Integer({ minimum: 18, maximum: 65535 }),
    type: Type.Literal('proxy.probe'),
    messageId: MessageIdSchema,
    correlationId: Type.Null(),
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        instanceId: Type.String({ format: 'uuid' }),
        proxyId: Type.String({ format: 'uuid' }),
        configurationVersion: Type.Integer({ minimum: 1 }),
        mode: ProxyProbeModeSchema,
        proxy: WorkerProfileProxySchema,
        targetUrl: Type.String({ format: 'uri', pattern: '^https://', maxLength: 2048 }),
        expiresAt: Type.String({ format: 'date-time' }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerProxyProbeCommandMessage = Type.Static<
  typeof WorkerProxyProbeCommandMessageSchema
>
export const WorkerProxyProbeResultMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
    protocolMinor: Type.Integer({ minimum: 18, maximum: 65535 }),
    type: Type.Literal('proxy.probe.result'),
    messageId: MessageIdSchema,
    correlationId: MessageIdSchema,
    sentAt: SentAtSchema,
    payload: Type.Object(
      { ...ProxyProbeResultSchema.properties, instanceId: Type.String({ format: 'uuid' }) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerProxyProbeResultMessage = Type.Static<typeof WorkerProxyProbeResultMessageSchema>

const ProfileCommandIdentity = {
  workerId: Type.String({ format: 'uuid' }),
  instanceId: Type.String({ format: 'uuid' }),
  profileId: Type.String({ format: 'uuid' }),
  generation: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  expiresAt: Type.String({ format: 'date-time' }),
}

export const WorkerStoragePolicyCommandMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
    protocolMinor: Type.Integer({ minimum: 19, maximum: 65535 }),
    type: Type.Literal('storage.policy.set'),
    messageId: MessageIdSchema,
    correlationId: Type.Null(),
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        instanceId: Type.String({ format: 'uuid' }),
        workerPolicy: StoragePolicySchema,
        profilePolicy: Type.Optional(ProfileStoragePolicySchema),
        expiresAt: Type.String({ format: 'date-time' }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerStoragePolicyCommandMessage = Type.Static<
  typeof WorkerStoragePolicyCommandMessageSchema
>
export const WorkerStoragePolicyResultMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
    protocolMinor: Type.Integer({ minimum: 19, maximum: 65535 }),
    type: Type.Literal('storage.policy.result'),
    messageId: MessageIdSchema,
    correlationId: MessageIdSchema,
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        instanceId: Type.String({ format: 'uuid' }),
        storage: WorkerStorageFactSchema,
        profileUsage: Type.Union([ProfileStorageUsageSchema, Type.Null()]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerStoragePolicyResultMessage = Type.Static<
  typeof WorkerStoragePolicyResultMessageSchema
>

export const WorkerProfileRuntimeCommandMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
    protocolMinor: Type.Integer({ minimum: 2, maximum: 65535 }),
    type: Type.Literal('profile.runtime.set'),
    messageId: MessageIdSchema,
    correlationId: Type.Null(),
    sentAt: SentAtSchema,
    payload: Type.Union([
      Type.Object(
        {
          ...ProfileCommandIdentity,
          action: Type.Literal('START'),
          requireExistingData: Type.Optional(Type.Boolean()),
          workerStoragePolicy: Type.Optional(StoragePolicySchema),
          profileStoragePolicy: Type.Optional(ProfileStoragePolicySchema),
          routeVersion: Type.Optional(Type.Integer({ minimum: 1 })),
          proxy: WorkerProfileProxySchema,
          healthcheckUrl: Type.String({ format: 'uri', pattern: '^https://', maxLength: 2048 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { ...ProfileCommandIdentity, action: Type.Enum(['STOP', 'DELETE'] as const) },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
)
export type WorkerProfileRuntimeCommandMessage = Type.Static<
  typeof WorkerProfileRuntimeCommandMessageSchema
>

type ProfileRuntimePayload = WorkerProfileRuntimeCommandMessage['payload']
export type WorkerProfileRuntimeRequest =
  | Omit<
      Extract<ProfileRuntimePayload, { action: 'START' }>,
      'workerId' | 'instanceId' | 'expiresAt'
    >
  | Omit<
      Extract<ProfileRuntimePayload, { action: 'STOP' | 'DELETE' }>,
      'workerId' | 'instanceId' | 'expiresAt'
    >

export const WorkerProfileRuntimeResultMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
    protocolMinor: Type.Integer({ minimum: 2, maximum: 65535 }),
    type: Type.Literal('profile.runtime.result'),
    messageId: MessageIdSchema,
    correlationId: MessageIdSchema,
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        instanceId: Type.String({ format: 'uuid' }),
        profileId: Type.String({ format: 'uuid' }),
        generation: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        action: Type.Enum(['START', 'STOP', 'DELETE'] as const),
        outcome: Type.Enum(['SUCCEEDED', 'FAILED'] as const),
        completedAt: Type.String({ format: 'date-time' }),
        runtime: Type.Union([WorkerProfileRuntimeFactSchema, Type.Null()]),
        error: Type.Union([
          Type.Object(
            {
              code: Type.String({ minLength: 1, maxLength: 128 }),
              message: Type.String({ minLength: 1, maxLength: 512 }),
            },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerProfileRuntimeResultMessage = Type.Static<
  typeof WorkerProfileRuntimeResultMessageSchema
>

const SessionCloseIdentity = {
  workerId: Type.String({ format: 'uuid' }),
  instanceId: Type.String({ format: 'uuid' }),
  sessionId: Type.String({ format: 'uuid' }),
  profileId: Type.String({ format: 'uuid' }),
  runtimeId: Type.String({ format: 'uuid' }),
  profileGeneration: Type.Integer({ minimum: 1, maximum: 2147483647 }),
}

export const WorkerSessionCloseCommandMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
    protocolMinor: Type.Integer({ minimum: 4, maximum: 65535 }),
    type: Type.Literal('session.close'),
    messageId: MessageIdSchema,
    correlationId: Type.Null(),
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        ...SessionCloseIdentity,
        expiresAt: Type.String({ format: 'date-time' }),
        creationExpiresAt: Type.String({ format: 'date-time' }),
        reason: Type.Enum([
          'USER_REQUESTED',
          'ADMIN_REQUESTED',
          'PASSWORD_RESET',
          'USER_DISABLED',
          'USER_DELETED',
          'PROFILE_DISABLED',
          'PROFILE_DELETED',
          'ACCESS_REVOKED',
          'WORKER_DISABLED',
        ] as const),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerSessionCloseCommandMessage = Type.Static<
  typeof WorkerSessionCloseCommandMessageSchema
>

export const WorkerSessionCloseResultMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
    protocolMinor: Type.Integer({ minimum: 4, maximum: 65535 }),
    type: Type.Literal('session.close.result'),
    messageId: MessageIdSchema,
    correlationId: MessageIdSchema,
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        ...SessionCloseIdentity,
        completedAt: Type.String({ format: 'date-time' }),
        outcome: Type.Enum(['SUCCEEDED', 'FAILED'] as const),
        error: Type.Union([
          Type.Object(
            {
              code: Type.String({ minLength: 1, maxLength: 128 }),
              message: Type.String({ minLength: 1, maxLength: 512 }),
            },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerSessionCloseResultMessage = Type.Static<
  typeof WorkerSessionCloseResultMessageSchema
>

const SessionCreatePayloadProperties = {
  workerStoragePolicy: Type.Optional(StoragePolicySchema),
  profileStoragePolicy: Type.Optional(ProfileStoragePolicySchema),
  ...SessionCloseIdentity,
  expiresAt: Type.String({ format: 'date-time' }),
  leaseExpiresAt: Type.String({ format: 'date-time' }),
  createdAt: Type.Optional(Type.String({ format: 'date-time' })),
  policy: Type.Optional(SessionPolicyValuesSchema),
  qualityPolicy: Type.Optional(ProfileQualityPolicySchema),
  transferSettings: Type.Optional(SessionTransferSettingsSchema),
  initialUrl: Type.String({ minLength: 1, maxLength: 16384 }),
  capabilities: Type.Array(Type.String({ minLength: 1, maxLength: 96 }), {
    maxItems: 128,
    uniqueItems: true,
  }),
  signaling: Type.Object(
    {
      gatewayId: Type.String({ format: 'uuid' }),
      endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
      bindingToken: Type.String({ minLength: 32, maxLength: 4096 }),
    },
    { additionalProperties: false },
  ),
  navigationUser: Type.Optional(
    Type.Object(
      { id: Type.String({ format: 'uuid' }), displayName: Type.String({ maxLength: 256 }) },
      { additionalProperties: false },
    ),
  ),
  pageScript: Type.Union([SessionPageScriptSchema, Type.Null()]),
}
const SessionCreateCommandProperties = {
  protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
  type: Type.Literal('session.create'),
  messageId: MessageIdSchema,
  correlationId: Type.Null(),
  sentAt: SentAtSchema,
}

// Missing kind belongs only to normal commands persisted before maintenance was introduced.
export const WorkerSessionCreateCommandMessageSchema = Type.Union([
  Type.Object(
    {
      ...SessionCreateCommandProperties,
      protocolMinor: Type.Integer({ minimum: 5, maximum: 13 }),
      payload: Type.Object(
        {
          ...SessionCreatePayloadProperties,
          transferSettings: Type.Optional(Type.Never()),
          qualityPolicy: Type.Optional(Type.Never()),
          kind: Type.Optional(Type.Literal('NORMAL')),
          navigationPolicy: SessionNavigationPolicySchema,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...SessionCreateCommandProperties,
      protocolMinor: Type.Integer({ minimum: 13, maximum: 13 }),
      payload: Type.Object(
        {
          ...SessionCreatePayloadProperties,
          transferSettings: Type.Optional(Type.Never()),
          qualityPolicy: Type.Optional(Type.Never()),
          kind: Type.Literal('MAINTENANCE'),
          navigationPolicy: Type.Null(),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...SessionCreateCommandProperties,
      protocolMinor: Type.Integer({ minimum: 14, maximum: 14 }),
      payload: Type.Object(
        {
          ...SessionCreatePayloadProperties,
          transferSettings: Type.Optional(Type.Never()),
          qualityPolicy: ProfileQualityPolicySchema,
          kind: Type.Optional(Type.Literal('NORMAL')),
          navigationPolicy: SessionNavigationPolicySchema,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...SessionCreateCommandProperties,
      protocolMinor: Type.Integer({ minimum: 14, maximum: 14 }),
      payload: Type.Object(
        {
          ...SessionCreatePayloadProperties,
          transferSettings: Type.Optional(Type.Never()),
          qualityPolicy: ProfileQualityPolicySchema,
          kind: Type.Literal('MAINTENANCE'),
          navigationPolicy: Type.Null(),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...SessionCreateCommandProperties,
      protocolMinor: Type.Integer({ minimum: 15, maximum: 65535 }),
      payload: Type.Object(
        {
          ...SessionCreatePayloadProperties,
          transferSettings: SessionTransferSettingsSchema,
          qualityPolicy: ProfileQualityPolicySchema,
          kind: Type.Optional(Type.Literal('NORMAL')),
          navigationPolicy: SessionNavigationPolicySchema,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...SessionCreateCommandProperties,
      protocolMinor: Type.Integer({ minimum: 15, maximum: 65535 }),
      payload: Type.Object(
        {
          ...SessionCreatePayloadProperties,
          transferSettings: SessionTransferSettingsSchema,
          qualityPolicy: ProfileQualityPolicySchema,
          kind: Type.Literal('MAINTENANCE'),
          navigationPolicy: Type.Null(),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
])
export type WorkerSessionCreateCommandMessage = Type.Static<
  typeof WorkerSessionCreateCommandMessageSchema
>

export const WorkerSessionCreateResultMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
    protocolMinor: Type.Integer({ minimum: 5, maximum: 65535 }),
    type: Type.Literal('session.create.result'),
    messageId: MessageIdSchema,
    correlationId: MessageIdSchema,
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        ...SessionCloseIdentity,
        completedAt: Type.String({ format: 'date-time' }),
        outcome: Type.Enum(['SUCCEEDED', 'FAILED'] as const),
        fact: Type.Union([WorkerSessionRuntimeFactSchema, Type.Null()]),
        error: Type.Union([
          Type.Object(
            {
              code: Type.String({ minLength: 1, maxLength: 128 }),
              message: Type.String({ minLength: 1, maxLength: 512 }),
            },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerSessionCreateResultMessage = Type.Static<
  typeof WorkerSessionCreateResultMessageSchema
>

export const WorkerSessionViewerCommandMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
    protocolMinor: Type.Integer({ minimum: 6, maximum: 65535 }),
    type: Type.Literal('session.viewer.prepare'),
    messageId: MessageIdSchema,
    correlationId: Type.Null(),
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        ...SessionCloseIdentity,
        expiresAt: Type.String({ format: 'date-time' }),
        ticket: SessionViewerTicketSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerSessionViewerCommandMessage = Type.Static<
  typeof WorkerSessionViewerCommandMessageSchema
>
export const WorkerSessionViewerResultMessageSchema = Type.Object(
  {
    ...WorkerSessionCreateResultMessageSchema.properties,
    protocolMinor: Type.Integer({ minimum: 6, maximum: 65535 }),
    type: Type.Literal('session.viewer.result'),
  },
  { additionalProperties: false },
)
export type WorkerSessionViewerResultMessage = Type.Static<
  typeof WorkerSessionViewerResultMessageSchema
>

export const WorkerSessionContinueCommandMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65535 }),
    protocolMinor: Type.Integer({ minimum: 8, maximum: 65535 }),
    type: Type.Literal('session.continue'),
    messageId: MessageIdSchema,
    correlationId: Type.Null(),
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        ...SessionCloseIdentity,
        expiresAt: Type.String({ format: 'date-time' }),
        viewerGeneration: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerSessionContinueCommandMessage = Type.Static<
  typeof WorkerSessionContinueCommandMessageSchema
>
export const WorkerSessionContinueResultMessageSchema = Type.Object(
  {
    ...WorkerSessionCreateResultMessageSchema.properties,
    protocolMinor: Type.Integer({ minimum: 8, maximum: 65535 }),
    type: Type.Literal('session.continue.result'),
  },
  { additionalProperties: false },
)
export type WorkerSessionContinueResultMessage = Type.Static<
  typeof WorkerSessionContinueResultMessageSchema
>

export const WorkerCommandAcceptedMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('worker.command.accepted'),
    messageId: MessageIdSchema,
    correlationId: MessageIdSchema,
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        commandType: WorkerCommandTypeSchema,
        acceptedAt: Type.String({ format: 'date-time' }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerCommandAcceptedMessage = Type.Static<typeof WorkerCommandAcceptedMessageSchema>

export const WorkerDiagnosticProbeResultMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('diagnostic.probe.result'),
    messageId: MessageIdSchema,
    correlationId: MessageIdSchema,
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        workerId: Type.String({ format: 'uuid' }),
        outcome: Type.Enum(['SUCCEEDED', 'FAILED'] as const),
        completedAt: Type.String({ format: 'date-time' }),
        report: Type.Union([WorkerCapabilityReportSchema, Type.Null()]),
        error: Type.Union([
          Type.Object(
            {
              code: Type.String({ minLength: 1, maxLength: 128 }),
              message: Type.String({ minLength: 1, maxLength: 512 }),
            },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerDiagnosticProbeResultMessage = Type.Static<
  typeof WorkerDiagnosticProbeResultMessageSchema
>

export const WorkerControlErrorCodeSchema = Type.Enum([
  'AUTHORIZATION_FAILED',
  'COMMAND_CAPACITY_EXCEEDED',
  'WORKER_RECONCILING',
  'COMMAND_ID_REUSED',
  'HELLO_TIMEOUT',
  'INVALID_MESSAGE',
  'PROTOCOL_MISMATCH',
  'REPLACED',
  'WORKER_DISABLED',
] as const)
export type WorkerControlErrorCode = Type.Static<typeof WorkerControlErrorCodeSchema>

export const WorkerControlErrorMessageSchema = Type.Object(
  {
    protocolMajor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    protocolMinor: Type.Integer({ minimum: 0, maximum: 65_535 }),
    type: Type.Literal('protocol.error'),
    messageId: MessageIdSchema,
    correlationId: Type.Union([MessageIdSchema, Type.Null()]),
    sentAt: SentAtSchema,
    payload: Type.Object(
      {
        code: WorkerControlErrorCodeSchema,
        message: Type.String({ minLength: 1, maxLength: 256 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
export type WorkerControlErrorMessage = Type.Static<typeof WorkerControlErrorMessageSchema>

export const WorkerControlMessageSchema = Type.Union([
  WorkerDownloadsMessageSchema,
  WorkerDownloadsAcceptedMessageSchema,
  WorkerHelloMessageSchema,
  WorkerHelloAcceptedMessageSchema,
  WorkerCapabilitiesMessageSchema,
  WorkerCapabilitiesAcceptedMessageSchema,
  WorkerHeartbeatMessageSchema,
  WorkerHeartbeatAcknowledgedMessageSchema,
  WorkerSnapshotMessageSchema,
  WorkerSnapshotAcceptedMessageSchema,
  WorkerDiagnosticProbeCommandMessageSchema,
  WorkerProxyProbeCommandMessageSchema,
  WorkerProxyProbeResultMessageSchema,
  WorkerStoragePolicyCommandMessageSchema,
  WorkerStoragePolicyResultMessageSchema,
  WorkerProfileRuntimeCommandMessageSchema,
  WorkerProfileRuntimeResultMessageSchema,
  WorkerSessionCloseCommandMessageSchema,
  WorkerSessionCloseResultMessageSchema,
  WorkerSessionCreateCommandMessageSchema,
  WorkerSessionCreateResultMessageSchema,
  WorkerSessionContinueCommandMessageSchema,
  WorkerSessionContinueResultMessageSchema,
  WorkerSessionViewerCommandMessageSchema,
  WorkerSessionViewerResultMessageSchema,
  WorkerCommandAcceptedMessageSchema,
  WorkerDiagnosticProbeResultMessageSchema,
  WorkerControlErrorMessageSchema,
])
export type WorkerControlMessage = Type.Static<typeof WorkerControlMessageSchema>

export class WorkerControlProtocolError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options)
    this.name = 'WorkerControlProtocolError'
  }
}

export function encodeWorkerControlMessage(message: WorkerControlMessage): Uint8Array {
  assertWorkerControlMessage(message)
  const encoded = encode(message, { ignoreUndefined: true })
  if (encoded.byteLength > WORKER_CONTROL_MAX_MESSAGE_BYTES) {
    throw new WorkerControlProtocolError('Worker control message exceeds 256 KiB')
  }
  return encoded
}

export function decodeWorkerControlMessage(data: Uint8Array): WorkerControlMessage {
  if (data.byteLength === 0 || data.byteLength > WORKER_CONTROL_MAX_MESSAGE_BYTES) {
    throw new WorkerControlProtocolError('Worker control frame size is invalid')
  }
  let decoded: unknown
  try {
    decoded = decode(data, {
      maxStrLength: 256 * 1024,
      maxBinLength: 256 * 1024,
      maxArrayLength: 8_192,
      maxMapLength: 256,
      maxExtLength: 0,
    })
  } catch (cause) {
    throw new WorkerControlProtocolError('Worker control frame is not valid MessagePack', {
      cause,
    })
  }
  assertWorkerControlMessage(decoded)
  return decoded
}

function assertWorkerControlMessage(value: unknown): asserts value is WorkerControlMessage {
  if (Value.Check(WorkerControlMessageSchema, value)) {
    if (value.protocolMinor < 22) {
      const facts =
        value.type === 'worker.snapshot'
          ? [...value.payload.snapshot.sessions, ...(value.payload.snapshot.closedSessions ?? [])]
          : 'fact' in value.payload && value.payload.fact
            ? [value.payload.fact]
            : []
      if (facts.some((fact) => fact.pageScriptError !== undefined))
        throw new WorkerControlProtocolError('Page Script error summaries require Control 1.22')
    }
    if (
      value.protocolMinor >= 21 &&
      value.type === 'profile.runtime.set' &&
      value.payload.action === 'START' &&
      value.payload.requireExistingData === undefined
    )
      throw new WorkerControlProtocolError('Control 1.21 START requires requireExistingData')
    if (value.type === 'session.create' && value.payload.pageScript?.context !== undefined) {
      if (
        value.payload.pageScript.context.profile_id !== value.payload.profileId ||
        value.payload.pageScript.context.user_id !== value.payload.navigationUser?.id
      )
        throw new WorkerControlProtocolError('Page Script context identity mismatch')
      try {
        assertProfileContextVariables(value.payload.pageScript.context.variables)
      } catch {
        throw new WorkerControlProtocolError(
          'Page Script context variables are invalid or contain credentials',
        )
      }
    }
    if (value.protocolMinor >= 19) {
      if (
        (value.type === 'profile.runtime.set' && value.payload.action === 'START') ||
        value.type === 'session.create'
      ) {
        if (
          !('workerStoragePolicy' in value.payload) ||
          !value.payload.workerStoragePolicy ||
          !('profileStoragePolicy' in value.payload) ||
          !value.payload.profileStoragePolicy
        )
          throw new WorkerControlProtocolError(
            'Control 1.19 creation requires both storage policies',
          )
        if (value.payload.profileStoragePolicy.profileId !== value.payload.profileId)
          throw new WorkerControlProtocolError('Storage policy Profile identity mismatch')
      }
      const observation =
        value.type === 'worker.heartbeat'
          ? value.payload
          : value.type === 'worker.snapshot'
            ? value.payload.snapshot
            : null
      if (observation && (!observation.storage || !observation.profileStorageUsage))
        throw new WorkerControlProtocolError('Control 1.19 requires storage observations')
    }
    if (value.protocolMinor >= 18) {
      if (
        value.type === 'profile.runtime.set' &&
        value.payload.action === 'START' &&
        value.payload.routeVersion === undefined
      )
        throw new WorkerControlProtocolError('Control 1.18 START requires routeVersion')
      const facts =
        value.type === 'worker.snapshot'
          ? value.payload.snapshot.profiles
          : value.type === 'profile.runtime.result' && value.payload.runtime !== null
            ? [value.payload.runtime]
            : []
      if (facts.some((fact) => fact.routeVersion === undefined || fact.proxyHealth === undefined))
        throw new WorkerControlProtocolError(
          'Control 1.18 Runtime facts require routeVersion and proxyHealth',
        )
    }
    return
  }
  const firstError = Value.Errors(WorkerControlMessageSchema, value)[0]
  throw new WorkerControlProtocolError(
    firstError === undefined
      ? 'Worker control message does not match the protocol schema'
      : `Worker control message schema failed: ${firstError.message}`,
  )
}

export function isWorkerRecoveryCommand(message: WorkerControlMessage): boolean {
  return (
    message.type === 'diagnostic.probe' ||
    message.type === 'session.close' ||
    (message.type === 'profile.runtime.set' && message.payload.action !== 'START')
  )
}
