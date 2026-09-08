import { createHmac, randomBytes } from 'node:crypto'
import type { GatewayViewerClaims } from '@browshare/contracts'
import type { GatewayConfiguration } from './configuration.js'

export interface GatewayIceServerProvider {
  getIceServers(
    role: 'core' | 'viewer',
    claims: GatewayViewerClaims,
  ): Promise<GatewayConfiguration['iceServers']>
}

export function createIceServerProvider(
  configuration: GatewayConfiguration,
): GatewayIceServerProvider {
  return {
    async getIceServers(role) {
      const turn = configuration.turn
      if (turn === undefined) return configuration.iceServers
      const expiresAt = Math.floor(Date.now() / 1000) + turn.credentialTtlSeconds
      // coturn's REST authentication signs the complete expiry-prefixed username.
      // An opaque suffix separates peers and allocations without exposing business IDs in TURN logs.
      const username = `${expiresAt}:${role}-${randomBytes(12).toString('hex')}`
      const credential = createHmac('sha1', turn.sharedSecret).update(username).digest('base64')
      return [{ urls: [...turn.urls], username, credential }]
    },
  }
}
