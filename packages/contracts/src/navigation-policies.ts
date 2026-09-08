import Type from 'typebox'
import { SessionNavigationPolicySchema, NavigationScriptContextSchema } from './session-creation.js'

export const NavigationPolicyContentSchema = Type.Omit(SessionNavigationPolicySchema, ['versionId'])
export const SaveNavigationPolicyDraftSchema = Type.Object(
  {
    content: NavigationPolicyContentSchema,
    changeSummary: Type.Union([Type.String({ maxLength: 512 }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type SaveNavigationPolicyDraft = Type.Static<typeof SaveNavigationPolicyDraftSchema>
export const NavigationPolicyVersionSummarySchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    profileId: Type.String({ format: 'uuid' }),
    version: Type.Integer({ minimum: 1 }),
    state: Type.Enum(['DRAFT', 'PUBLISHED', 'DISABLED'] as const),
    ruleCount: Type.Integer({ minimum: 0 }),
    hasScript: Type.Boolean(),
    changeSummary: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    publishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    disabledAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  },
  { additionalProperties: false },
)
export const NavigationPolicyVersionSchema = Type.Object(
  {
    ...NavigationPolicyVersionSummarySchema.properties,
    content: NavigationPolicyContentSchema,
  },
  { additionalProperties: false },
)
export type NavigationPolicyVersion = Type.Static<typeof NavigationPolicyVersionSchema>
export const NavigationPolicyStateSchema = Type.Object(
  {
    profile: Type.Object({ id: Type.String({ format: 'uuid' }), name: Type.String() }),
    publishedVersionId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    draft: Type.Union([NavigationPolicyVersionSchema, Type.Null()]),
  },
  { additionalProperties: false },
)
export const NavigationPolicyPreviewRequestSchema = Type.Object(
  {
    content: NavigationPolicyContentSchema,
    url: Type.String({ minLength: 1, maxLength: 16384 }),
    context: Type.Optional(NavigationScriptContextSchema),
  },
  { additionalProperties: false },
)
export type NavigationPolicyPreviewRequest = Type.Static<
  typeof NavigationPolicyPreviewRequestSchema
>
export const NavigationPolicyPreviewSchema = Type.Object(
  {
    action: Type.Enum([
      'ALLOW_REMOTE',
      'DENY',
      'REDIRECT_REMOTE',
      'PROMPT_REMOTE',
      'OPEN_LOCAL_PROMPT',
    ] as const),
    matchedRuleId: Type.Union([Type.String(), Type.Null()]),
    normalizedUrl: Type.Union([Type.String(), Type.Null()]),
    redirectUrl: Type.Union([Type.String(), Type.Null()]),
    reason: Type.Enum([
      'RULE',
      'DEFAULT',
      'UNSAFE_URL',
      'SCRIPT',
      'SCRIPT_ERROR',
      'SCRIPT_TIMEOUT',
      'SCRIPT_BUSY',
      'SCRIPT_INVALID',
    ] as const),
  },
  { additionalProperties: false },
)
