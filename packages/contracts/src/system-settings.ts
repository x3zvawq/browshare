import Type from 'typebox'
import { ProfileQualityPolicySchema } from './media-policy.js'

export const SessionMediaSettingsSchema = Type.Object(
  {
    qualityPolicy: ProfileQualityPolicySchema,
    tabAudioEnabled: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type SessionMediaSettings = Type.Static<typeof SessionMediaSettingsSchema>

export const RegistrationSettingsSchema = Type.Object(
  {
    registrationOpen: Type.Boolean(),
    emailVerificationRequired: Type.Boolean(),
    defaultMaxActiveSessions: Type.Union([
      Type.Integer({ minimum: 0, maximum: 1_000_000 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
)
export type RegistrationSettings = Type.Static<typeof RegistrationSettingsSchema>

export const SessionTransferSettingsSchema = Type.Object(
  {
    uploadEnabled: Type.Boolean(),
    downloadEnabled: Type.Boolean(),
    clipboardTextEnabled: Type.Boolean(),
    clipboardImageEnabled: Type.Boolean(),
    maxFileBytes: Type.Integer({ minimum: 1, maximum: 536_870_912 }),
    maxFiles: Type.Integer({ minimum: 1, maximum: 64 }),
    maxTemporaryBytes: Type.Integer({ minimum: 1, maximum: 2_147_483_648 }),
    allowedExtensions: Type.Array(Type.String({ pattern: '^\\.[a-z0-9][a-z0-9._+-]{0,31}$' }), {
      maxItems: 64,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
)
export type SessionTransferSettings = Type.Static<typeof SessionTransferSettingsSchema>

export const ViewerFocusPolicySchema = Type.Object(
  {
    mode: Type.Enum(['NEVER', 'WHEN_HIDDEN', 'WHEN_UNFOCUSED'] as const),
    gracePeriodMs: Type.Integer({ minimum: 0, maximum: 300_000 }),
  },
  { additionalProperties: false },
)
export type ViewerFocusPolicy = Type.Static<typeof ViewerFocusPolicySchema>
