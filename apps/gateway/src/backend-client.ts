import {
  GatewayAuthorizationResponseSchema,
  GatewayHealthSchema,
  GatewayTicketConsumeResponseSchema,
  type GatewayCoreAuthorizationRequest,
  type GatewayViewerClaims,
} from '@browshare/contracts'
import type { TSchema } from 'typebox'
import { Value } from 'typebox/value'
import type { GatewayConfiguration } from './configuration.js'

export class GatewayBackendClient {
  constructor(private readonly configuration: GatewayConfiguration) {}
  async ready(): Promise<boolean> {
    try {
      const value = await this.request('/health', GatewayHealthSchema)
      return (
        Value.Check(GatewayHealthSchema, value) &&
        value.gatewayId === this.configuration.id &&
        value.ready
      )
    } catch {
      return false
    }
  }
  async consumeTicket(ticket: string): Promise<{ claims: GatewayViewerClaims }> {
    const value = await this.request('/tickets/consume', GatewayTicketConsumeResponseSchema, {
      ticket,
    })
    if (!Value.Check(GatewayTicketConsumeResponseSchema, value))
      throw new Error('Invalid Gateway ticket response')
    return value
  }
  async authorizeCore(input: GatewayCoreAuthorizationRequest): Promise<boolean> {
    try {
      const value = await this.request('/core/authorize', GatewayAuthorizationResponseSchema, input)
      return Value.Check(GatewayAuthorizationResponseSchema, value) && value.allowed
    } catch {
      return false
    }
  }
  private async request(path: string, schema: TSchema, body?: unknown): Promise<unknown> {
    const response = await fetch(
      this.configuration.backendUrl + '/internal/gateways/' + this.configuration.id + path,
      {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: {
          authorization: 'Bearer ' + this.configuration.secret,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    )
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('Backend rejected Gateway authorization')
    }
    const value: unknown = await response.json()
    if (!Value.Check(schema, value)) throw new Error('Backend Gateway response is invalid')
    return value
  }
}
