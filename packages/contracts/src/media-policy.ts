import Type from 'typebox'

export const ProfileQualityPolicySchema = Type.Object(
  {
    maxWidth: Type.Integer({ minimum: 1, maximum: 1920 }),
    maxHeight: Type.Integer({ minimum: 1, maximum: 1080 }),
    maxFps: Type.Integer({ minimum: 1, maximum: 60 }),
    maxBitrateKbps: Type.Union([Type.Integer({ minimum: 100, maximum: 20_000 }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type ProfileQualityPolicy = Type.Static<typeof ProfileQualityPolicySchema>
