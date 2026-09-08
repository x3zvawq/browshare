import { optionalSecret, type Environment } from '@browshare/config'
import { isPublicId } from '@browshare/common'
import Type from 'typebox'
import { Value } from 'typebox/value'

const schema = Type.Array(
  Type.Object(
    {
      id: Type.String({ format: 'uuid' }),
      publicEndpoint: Type.String({ maxLength: 2048 }),
      healthUrl: Type.String({ maxLength: 2048 }),
      secret: Type.String({ minLength: 32, maxLength: 4096 }),
    },
    { additionalProperties: false },
  ),
  { maxItems: 32 },
)
export type GatewayConfiguration = Type.Static<typeof schema>[number]

export function loadGatewayConfiguration(
  environment: Environment,
): readonly GatewayConfiguration[] {
  const source = optionalSecret(environment, 'BROWSHARE_GATEWAYS_JSON', { maxLength: 262144 })
  if (source === undefined) return []
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new TypeError('BROWSHARE_GATEWAYS_JSON must be valid JSON')
  }
  if (!Value.Check(schema, value))
    throw new TypeError('BROWSHARE_GATEWAYS_JSON configuration is invalid')
  const ids = new Set<string>(),
    endpoints = new Set<string>()
  for (const entry of value) {
    if (!isPublicId(entry.id) || ids.has(entry.id))
      throw new TypeError('Gateway IDs must be unique UUIDv7 values')
    ids.add(entry.id)
    const endpoint = parseUrl(entry.publicEndpoint),
      health = parseUrl(entry.healthUrl)
    if (endpoint.protocol !== 'wss:')
      throw new TypeError('Gateway public endpoints must use wss://')
    if (
      !['http:', 'https:'].includes(health.protocol) ||
      (health.protocol === 'http:' &&
        !['127.0.0.1', 'localhost', '[::1]'].includes(health.hostname))
    )
      throw new TypeError('Gateway health URL requires HTTPS or loopback HTTP')
    if (endpoints.has(endpoint.href)) throw new TypeError('Gateway public endpoints must be unique')
    endpoints.add(endpoint.href)
  }
  return value
}
function parseUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('Gateway URL is invalid')
  }
  if (url.username || url.password || url.search || url.hash)
    throw new TypeError('Gateway URL cannot contain credentials, query or fragment')
  return url
}
