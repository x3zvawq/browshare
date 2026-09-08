import { ViewerFocusPolicySchema } from './system-settings.js'
import Type from 'typebox'

export const GatewayCapabilitiesSchema = Type.Array(Type.String({ minLength: 1, maxLength: 96 }), {
  maxItems: 128,
  uniqueItems: true,
})
export const GatewayViewerClaimsSchema = Type.Object(
  {
    sessionId: Type.String({ format: 'uuid' }),
    viewerGeneration: Type.Integer({ minimum: 1, maximum: 2147483647 }),
    gatewayId: Type.String({ format: 'uuid' }),
    capabilities: GatewayCapabilitiesSchema,
    issuedAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    expiresAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    jti: Type.String({ format: 'uuid' }),
    issuer: Type.Literal('browshare'),
    audience: Type.Literal('remote-tab-viewer'),
  },
  { additionalProperties: false },
)
export type GatewayViewerClaims = Type.Static<typeof GatewayViewerClaimsSchema>
export const SessionViewerTicketSchema = Type.Object(
  {
    token: Type.String({ minLength: 32, maxLength: 4096 }),
    claims: GatewayViewerClaimsSchema,
  },
  { additionalProperties: false },
)
export type SessionViewerTicket = Type.Static<typeof SessionViewerTicketSchema>
export const SessionViewerRequestSchema = Type.Object(
  {
    clientId: Type.String({ format: 'uuid' }),
    takeoverGeneration: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483647 })),
  },
  { additionalProperties: false },
)
export type SessionViewerRequest = Type.Static<typeof SessionViewerRequestSchema>
export const SessionViewerLaunchSchema = Type.Object(
  {
    sessionId: Type.String({ format: 'uuid' }),
    gatewayId: Type.String({ format: 'uuid' }),
    signalingUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    viewerGeneration: Type.Integer({ minimum: 1, maximum: 2147483647 }),
    ticket: Type.String({ minLength: 32, maxLength: 4096 }),
    expiresAt: Type.String({ format: 'date-time' }),
    capabilities: GatewayCapabilitiesSchema,
    focusPolicy: ViewerFocusPolicySchema,
  },
  { additionalProperties: false },
)
export type SessionViewerLaunch = Type.Static<typeof SessionViewerLaunchSchema>
export const GatewayTicketConsumeRequestSchema = Type.Object(
  {
    ticket: Type.String({ minLength: 32, maxLength: 4096 }),
  },
  { additionalProperties: false },
)
export const GatewayTicketConsumeResponseSchema = Type.Object(
  {
    claims: GatewayViewerClaimsSchema,
  },
  { additionalProperties: false },
)
export const GatewayCoreAuthorizationRequestSchema = Type.Object(
  {
    bindingToken: Type.String({ minLength: 32, maxLength: 4096 }),
    sessionId: Type.String({ format: 'uuid' }),
    viewerGeneration: Type.Integer({ minimum: 1, maximum: 2147483647 }),
    gatewayId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
)
export type GatewayCoreAuthorizationRequest = Type.Static<
  typeof GatewayCoreAuthorizationRequestSchema
>
export const GatewayAuthorizationResponseSchema = Type.Object(
  { allowed: Type.Boolean() },
  { additionalProperties: false },
)
export const GatewayHealthSchema = Type.Object(
  {
    gatewayId: Type.String({ format: 'uuid' }),
    protocolVersion: Type.Literal(1),
    ready: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type GatewayHealth = Type.Static<typeof GatewayHealthSchema>
