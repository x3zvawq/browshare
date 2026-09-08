import Type from 'typebox'

const TimeoutSchema = Type.Union([Type.Integer({ minimum: 1, maximum: 2147483647 }), Type.Null()])

export const SessionPolicyValuesSchema = Type.Object(
  {
    recycleDisabled: Type.Boolean(),
    viewerDisconnectTimeoutSeconds: TimeoutSchema,
    noInputTimeoutSeconds: TimeoutSchema,
    noFrameChangeTimeoutSeconds: TimeoutSchema,
    maxDurationSeconds: TimeoutSchema,
    proxyFailureTimeoutSeconds: TimeoutSchema,
    countdownSeconds: Type.Integer({ minimum: 0, maximum: 2147483647 }),
  },
  { additionalProperties: false },
)
export type SessionPolicyValues = Type.Static<typeof SessionPolicyValuesSchema>
export const DEFAULT_SESSION_POLICY: Readonly<SessionPolicyValues> = Object.freeze({
  recycleDisabled: false,
  viewerDisconnectTimeoutSeconds: 300,
  noInputTimeoutSeconds: null,
  noFrameChangeTimeoutSeconds: null,
  maxDurationSeconds: null,
  proxyFailureTimeoutSeconds: null,
  countdownSeconds: 60,
})

export const SessionRecycleReasonSchema = Type.Enum([
  'MAX_DURATION',
  'PROXY_FAILURE',
  'VIEWER_DISCONNECTED',
  'NO_INPUT',
  'NO_FRAME_CHANGE',
] as const)
export type SessionRecycleReason = Type.Static<typeof SessionRecycleReasonSchema>

export const SessionRecycleStateSchema = Type.Object(
  {
    reason: SessionRecycleReasonSchema,
    deadline: Type.String({ format: 'date-time' }),
    countdownStartsAt: Type.String({ format: 'date-time' }),
    canContinue: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type SessionRecycleState = Type.Static<typeof SessionRecycleStateSchema>
