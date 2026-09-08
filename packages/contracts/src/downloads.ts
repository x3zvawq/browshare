import Type from 'typebox'

/** Worker-owned file metadata. Backend derives user/Profile ownership from sessionId and Worker identity. */
export const RetainedDownloadSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    sessionId: Type.String({ format: 'uuid' }),
    displayName: Type.String({ minLength: 1, maxLength: 255 }),
    size: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    status: Type.Enum(['AVAILABLE', 'CLAIMED', 'EXPIRED'] as const),
    completedAt: Type.String({ format: 'date-time' }),
    expiresAt: Type.String({ format: 'date-time' }),
    sessionEndedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    claimedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type RetainedDownload = Type.Static<typeof RetainedDownloadSchema>

export const DownloadListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ format: 'uuid' })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
)
export type DownloadListQuery = Type.Static<typeof DownloadListQuerySchema>
export const DownloadListResponseSchema = Type.Object(
  {
    items: Type.Array(RetainedDownloadSchema),
    nextCursor: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    workerOnline: Type.Boolean(),
    serverTime: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type DownloadListResponse = Type.Static<typeof DownloadListResponseSchema>
export const DownloadClaimTokenSchema = Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' })
export const DownloadClaimSchema = Type.Object(
  {
    claimId: Type.String({ format: 'uuid' }),
    token: DownloadClaimTokenSchema,
    endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
    expiresAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type DownloadClaim = Type.Static<typeof DownloadClaimSchema>
export const DownloadConsumeRequestSchema = Type.Object(
  {
    instanceId: Type.String({ format: 'uuid' }),
    token: DownloadClaimTokenSchema,
  },
  { additionalProperties: false },
)
export const DownloadCheckRequestSchema = Type.Object(
  {
    instanceId: Type.String({ format: 'uuid' }),
    claimId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
)
export const DownloadAuthorizationSchema = Type.Object(
  {
    claimId: Type.String({ format: 'uuid' }),
    downloadId: Type.String({ format: 'uuid' }),
    sessionId: Type.String({ format: 'uuid' }),
    expiresAt: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
)
export type DownloadAuthorization = Type.Static<typeof DownloadAuthorizationSchema>
