import Type from 'typebox'

export const ProfileContextVariablesSchema = Type.Record(Type.String(), Type.Unknown())
export const SaveProfileContextSchema = Type.Object(
  { variables: ProfileContextVariablesSchema },
  { additionalProperties: false },
)
export type SaveProfileContext = Type.Static<typeof SaveProfileContextSchema>
export const ProfileContextSchema = Type.Object(
  {
    profileId: Type.String({ format: 'uuid' }),
    userId: Type.String({ format: 'uuid' }),
    variables: ProfileContextVariablesSchema,
    updatedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  },
  { additionalProperties: false },
)
export type ProfileContext = Type.Static<typeof ProfileContextSchema>
export const SessionPageScriptContextSchema = Type.Object(
  {
    user_id: Type.String({ format: 'uuid' }),
    display_name: Type.String({ maxLength: 256 }),
    profile_id: Type.String({ format: 'uuid' }),
    variables: ProfileContextVariablesSchema,
  },
  { additionalProperties: false },
)
export type SessionPageScriptContext = Type.Static<typeof SessionPageScriptContextSchema>

/** MAIN world is visible to the destination site; these are public business hints, never secrets. */
export function assertProfileContextVariables(
  value: unknown,
): asserts value is Record<string, unknown> {
  const invalid = () => {
    throw new TypeError(
      'Page Script variables must be a JSON object within 32 KiB and 8 nesting levels.',
    )
  }
  const sensitive = () => {
    throw new TypeError(
      'Page Script variables cannot contain credentials, passwords, cookies or tokens.',
    )
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid()
  const visit = (item: unknown, depth: number): void => {
    if (depth > 8) invalid()
    if (item === null || typeof item === 'boolean') return
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid()
      return
    }
    if (typeof item === 'string') {
      if (
        /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/i.test(item) ||
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(item) ||
        /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(item) ||
        /\b(?:https?|socks5):\/\/[^\s/@]+:[^\s/@]*@/i.test(item) ||
        /(?:^|\n)\s*(?:cookie|set-cookie|authorization|proxy-authorization)\s*:/i.test(item)
      )
        sensitive()
      return
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1)
      return
    }
    if (
      typeof item !== 'object' ||
      item === null ||
      Object.getPrototypeOf(item) !== Object.prototype
    )
      invalid()
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      const normalized = key
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}]/gu, '')
        .toLowerCase()
      if (
        /password|passwd|passphrase|cookie|token|secret|credential|authorization|privatekey|apikey|密码|口令|凭据|令牌/.test(
          normalized,
        )
      )
        sensitive()
      visit(child, depth + 1)
    }
  }
  visit(value, 0)
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 32_768) invalid()
}
