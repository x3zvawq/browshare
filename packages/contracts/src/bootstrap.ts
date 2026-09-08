import Type from 'typebox'

export const BootstrapStatusSchema = Type.Object(
  { initialized: Type.Boolean(), interactiveEnabled: Type.Boolean() },
  { additionalProperties: false },
)
export type BootstrapStatus = Type.Static<typeof BootstrapStatusSchema>

export const BootstrapRequestSchema = Type.Object(
  {
    token: Type.String({ minLength: 1, maxLength: 1024 }),
    email: Type.String({ format: 'email', minLength: 3, maxLength: 320 }),
    displayName: Type.String({ minLength: 1, maxLength: 128 }),
    password: Type.String({ minLength: 10, maxLength: 1024 }),
  },
  { additionalProperties: false },
)
export type BootstrapRequest = Type.Static<typeof BootstrapRequestSchema>

export const BootstrapCompleteSchema = Type.Object(
  { initialized: Type.Literal(true) },
  { additionalProperties: false },
)
