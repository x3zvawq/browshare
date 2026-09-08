import {
  ApiErrorEnvelopeSchema,
  GatewayAuthorizationResponseSchema,
  GatewayCoreAuthorizationRequestSchema,
  GatewayHealthSchema,
  GatewayTicketConsumeRequestSchema,
  GatewayTicketConsumeResponseSchema,
  type GatewayCoreAuthorizationRequest,
} from '@browshare/contracts'
import Type from 'typebox'
import type { BackendApp } from '../app.js'
import type { GatewayService } from '../services/gateways.js'

export function registerGatewayRoutes(
  app: BackendApp,
  gateways: Pick<GatewayService, 'authenticate' | 'consumeTicket' | 'authorizeCore' | 'ready'>,
): void {
  const root = '/internal/gateways/:id'
  const params = Type.Object(
    { id: Type.String({ format: 'uuid' }) },
    { additionalProperties: false },
  )
  const errors = { 400: ApiErrorEnvelopeSchema, 401: ApiErrorEnvelopeSchema }
  app.get<{ Params: { id: string } }>(
    root + '/health',
    {
      schema: { hide: true, params, response: { 200: GatewayHealthSchema, ...errors } },
    },
    async (request) => {
      gateways.authenticate(request.params.id, request.headers.authorization)
      await gateways.ready()
      return { gatewayId: request.params.id, protocolVersion: 1, ready: true }
    },
  )
  app.post<{ Params: { id: string }; Body: { ticket: string } }>(
    root + '/tickets/consume',
    {
      schema: {
        hide: true,
        params,
        body: GatewayTicketConsumeRequestSchema,
        response: { 200: GatewayTicketConsumeResponseSchema, ...errors },
      },
    },
    async (request) => {
      gateways.authenticate(request.params.id, request.headers.authorization)
      return gateways.consumeTicket(request.params.id, request.body.ticket)
    },
  )
  app.post<{ Params: { id: string }; Body: GatewayCoreAuthorizationRequest }>(
    root + '/core/authorize',
    {
      schema: {
        hide: true,
        params,
        body: GatewayCoreAuthorizationRequestSchema,
        response: { 200: GatewayAuthorizationResponseSchema, ...errors },
      },
    },
    async (request) => {
      gateways.authenticate(request.params.id, request.headers.authorization)
      return { allowed: await gateways.authorizeCore(request.params.id, request.body) }
    },
  )
}
