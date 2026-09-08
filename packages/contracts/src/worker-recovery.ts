import Type from 'typebox'

export const WorkerCleanupErrorSchema = Type.Object(
  {
    code: Type.String({ pattern: '^[A-Z][A-Z0-9_]{0,127}$' }),
    occurredAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type WorkerCleanupError = Type.Static<typeof WorkerCleanupErrorSchema>
export const WorkerCleanupFailureSchema = Type.Object(
  {
    registered: Type.Boolean(),
    scope: Type.Enum(['SESSION', 'PROFILE'] as const),
    profileId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    runtimeId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    generation: Type.Integer({ minimum: 0 }),
    sessionId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    error: WorkerCleanupErrorSchema,
  },
  { additionalProperties: false },
)
export type WorkerCleanupFailure = Type.Static<typeof WorkerCleanupFailureSchema>
export const ProfileRuntimeRecoverySchema = Type.Object(
  {
    canRecover: Type.Boolean(),
    blockedReason: Type.Union([
      Type.Enum([
        'WORKER_UNAVAILABLE',
        'WORKER_PROTOCOL_INCOMPATIBLE',
        'RUNTIME_UNOBSERVED',
        'RUNTIME_STOPPED',
      ] as const),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
)
export type ProfileRuntimeRecovery = Type.Static<typeof ProfileRuntimeRecoverySchema>
