import Type from 'typebox'
import { SessionPageScriptContextSchema } from './profile-contexts.js'

export const TabSessionCreateRequestSchema = Type.Object(
  {
    profileId: Type.String({ format: 'uuid' }),
    initialUrl: Type.String({ minLength: 1, maxLength: 16384 }),
  },
  { additionalProperties: false },
)
export type TabSessionCreateRequest = Type.Static<typeof TabSessionCreateRequestSchema>

export const SessionNavigationPolicySchema = Type.Object(
  {
    versionId: Type.String({ format: 'uuid' }),
    defaultAction: Type.Enum(['ALLOW_REMOTE', 'DENY'] as const),
    rules: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1, maxLength: 128 }),
          enabled: Type.Boolean(),
          pattern: Type.String({ minLength: 1, maxLength: 2048 }),
          action: Type.Enum([
            'ALLOW_REMOTE',
            'DENY',
            'REDIRECT_REMOTE',
            'PROMPT_REMOTE',
            'OPEN_LOCAL_PROMPT',
            'DEFER_TO_SCRIPT',
          ] as const),
          redirectUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 16384 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: 256 },
    ),
    policyScript: Type.Union([Type.String({ maxLength: 65536 }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type SessionNavigationPolicy = Type.Static<typeof SessionNavigationPolicySchema>

export const SessionPageScriptSchema = Type.Object(
  {
    versionId: Type.String({ format: 'uuid' }),
    source: Type.String({ maxLength: 65536 }),
    context: Type.Optional(SessionPageScriptContextSchema),
  },
  { additionalProperties: false },
)

export const NavigationScriptContextSchema = Type.Object(
  {
    source: Type.Enum(['initial', 'viewer', 'document', 'local-open'] as const),
    currentUrl: Type.Union([Type.String({ maxLength: 16384 }), Type.Null()]),
    user: Type.Union([
      Type.Object(
        { id: Type.String({ format: 'uuid' }), displayName: Type.String({ maxLength: 256 }) },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    session: Type.Union([
      Type.Object(
        { id: Type.String({ format: 'uuid' }), profileId: Type.String({ format: 'uuid' }) },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
)
export type NavigationScriptContext = Type.Static<typeof NavigationScriptContextSchema>

export const MaintenanceSessionCreateRequestSchema = Type.Object(
  {
    initialUrl: Type.String({ minLength: 1, maxLength: 16384 }),
    pageScriptVersionId: Type.Optional(Type.String({ format: 'uuid' })),
  },
  { additionalProperties: false },
)
export type MaintenanceSessionCreateRequest = Type.Static<
  typeof MaintenanceSessionCreateRequestSchema
>
