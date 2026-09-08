import Type from 'typebox'
import {
  WorkerProbeCheckNameSchema,
  WorkerProbeCheckStatusSchema,
  WorkerRuntimeMetricsSchema,
} from './worker-control.js'
const id = Type.String({ format: 'uuid' })
const nullableId = Type.Union([id, Type.Null()])
const time = Type.String({ format: 'date-time' })
const nullableTime = Type.Union([time, Type.Null()])
const code = Type.Union([Type.String({ maxLength: 128 }), Type.Null()])
const integer = Type.Integer({ minimum: 0 })
const version = Type.Union([
  Type.String({ pattern: '^[0-9]+(?:\\.[0-9]+){1,3}$', maxLength: 128 }),
  Type.Null(),
])
const object = <T extends Type.TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })
const section = <T extends Type.TSchema>(item: T) =>
  object({ items: Type.Array(item, { maxItems: 200 }), truncated: Type.Boolean() })
export const DiagnosticBundleQuerySchema = object({ sessionId: Type.Optional(id) })
export type DiagnosticBundleQuery = Type.Static<typeof DiagnosticBundleQuerySchema>
export const DiagnosticBundleSchema = object({
  format: Type.Literal('browshare.diagnostics.v1'),
  requestId: id,
  startedAt: time,
  completedAt: time,
  scope: object({ sessionId: nullableId }),
  backend: object({
    version: Type.String({ maxLength: 64 }),
    node: Type.String({ maxLength: 64 }),
    controlProtocol: Type.String({ maxLength: 32 }),
    uptimeSeconds: Type.Number({ minimum: 0 }),
  }),
  workers: section(
    object({
      id,
      status: Type.Enum(['PENDING', 'ONLINE', 'DRAINING', 'OFFLINE', 'DISABLED']),
      lastSeenAt: nullableTime,
      lastSnapshotAt: nullableTime,
      connected: Type.Boolean(),
      ready: Type.Boolean(),
      recoveryReady: Type.Boolean(),
      instanceId: nullableId,
      protocolMinor: Type.Union([integer, Type.Null()]),
      versions: object({
        worker: version,
        controlProtocol: version,
        node: version,
        chrome: version,
        remoteTabCore: version,
        extension: version,
      }),
      probe: Type.Union([
        object({
          status: Type.Enum(['READY', 'FAILED']),
          completedAt: time,
          checks: Type.Array(
            object({ name: WorkerProbeCheckNameSchema, status: WorkerProbeCheckStatusSchema }),
            { maxItems: 32 },
          ),
        }),
        Type.Null(),
      ]),
      metrics: Type.Union([
        object({ observedAt: time, receivedAt: time, metrics: WorkerRuntimeMetricsSchema }),
        Type.Null(),
      ]),
    }),
  ),
  profiles: section(
    object({
      id,
      workerId: id,
      runtimeId: nullableId,
      workerInstanceId: nullableId,
      generation: integer,
      state: Type.String({ maxLength: 32 }),
      observedAt: nullableTime,
      errorCode: code,
    }),
  ),
  sessions: section(
    object({
      id,
      profileId: id,
      workerId: id,
      gatewayId: nullableId,
      runtimeId: nullableId,
      workerInstanceId: nullableId,
      profileGeneration: Type.Union([integer, Type.Null()]),
      viewerGeneration: integer,
      kind: Type.Enum(['NORMAL', 'MAINTENANCE']),
      status: Type.String({ maxLength: 32 }),
      pageScriptVersionId: nullableId,
      navigationPolicyVersionId: nullableId,
      createdAt: time,
      updatedAt: time,
      closedAt: nullableTime,
      failureCode: code,
    }),
  ),
  audit: section(
    object({
      id,
      action: Type.String({ maxLength: 128 }),
      targetType: Type.String({ maxLength: 96 }),
      targetId: nullableId,
      result: Type.Enum(['SUCCEEDED', 'DENIED', 'FAILED']),
      requestId: nullableId,
      commandId: nullableId,
      occurredAt: time,
    }),
  ),
})
export type DiagnosticBundle = Type.Static<typeof DiagnosticBundleSchema>
