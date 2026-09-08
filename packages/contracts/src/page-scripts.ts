import Type from 'typebox'

export const PageScriptContentSchema = Type.Object(
  {
    source: Type.String({ maxLength: 65536 }),
    appliesTo: Type.Enum(['NORMAL', 'MAINTENANCE', 'BOTH'] as const),
  },
  { additionalProperties: false },
)
export const SavePageScriptDraftSchema = Type.Object(
  {
    content: PageScriptContentSchema,
    changeSummary: Type.Union([Type.String({ maxLength: 512 }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type SavePageScriptDraft = Type.Static<typeof SavePageScriptDraftSchema>
export const PageScriptVersionSummarySchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    profileId: Type.String({ format: 'uuid' }),
    version: Type.Integer({ minimum: 1 }),
    state: Type.Enum(['DRAFT', 'PUBLISHED', 'DISABLED'] as const),
    appliesTo: Type.Enum(['NORMAL', 'MAINTENANCE', 'BOTH'] as const),
    changeSummary: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    publishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    disabledAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  },
  { additionalProperties: false },
)
export const PageScriptVersionSchema = Type.Object(
  {
    ...PageScriptVersionSummarySchema.properties,
    content: PageScriptContentSchema,
  },
  { additionalProperties: false },
)
export type PageScriptVersion = Type.Static<typeof PageScriptVersionSchema>
export const PageScriptStateSchema = Type.Object(
  {
    profile: Type.Object({ id: Type.String({ format: 'uuid' }), name: Type.String() }),
    publishedVersionId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    draft: Type.Union([PageScriptVersionSchema, Type.Null()]),
  },
  { additionalProperties: false },
)
