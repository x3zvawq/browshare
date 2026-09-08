import Type from 'typebox'

export const RuntimeProxyHealthSchema = Type.Object(
  {
    status: Type.Enum(['HEALTHY', 'UNHEALTHY'] as const),
    checkedAt: Type.String({ format: 'date-time' }),
    lastSucceededAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    latencyMilliseconds: Type.Union([Type.Integer({ minimum: 0, maximum: 300000 }), Type.Null()]),
    httpStatus: Type.Union([Type.Integer({ minimum: 100, maximum: 599 }), Type.Null()]),
    errorCode: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type RuntimeProxyHealth = Type.Static<typeof RuntimeProxyHealthSchema>

export const ProfileRouteSummaryProperties = {
  routeVersion: Type.Integer({ minimum: 1 }),
  runtimeRouteVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  runtimeProxyHealth: Type.Union([RuntimeProxyHealthSchema, Type.Null()]),
  restartRequired: Type.Boolean(),
}
export const ProxyProbeModeSchema = Type.Enum(['health', 'exit-ip'] as const)
export const ProxyProbeRequestSchema = Type.Union([
  Type.Object(
    { workerId: Type.String({ format: 'uuid' }), mode: Type.Literal('health') },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      workerId: Type.String({ format: 'uuid' }),
      mode: Type.Literal('exit-ip'),
      exitIpUrl: Type.String({ format: 'uri', pattern: '^https://', maxLength: 2048 }),
    },
    { additionalProperties: false },
  ),
])
export type ProxyProbeRequest = Type.Static<typeof ProxyProbeRequestSchema>
export const ProxyProbeResultSchema = Type.Object(
  {
    ...RuntimeProxyHealthSchema.properties,
    proxyId: Type.String({ format: 'uuid' }),
    workerId: Type.String({ format: 'uuid' }),
    configurationVersion: Type.Integer({ minimum: 1 }),
    mode: ProxyProbeModeSchema,
    exitIp: Type.Union([Type.String({ minLength: 2, maxLength: 45 }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type ProxyProbeResult = Type.Static<typeof ProxyProbeResultSchema>
