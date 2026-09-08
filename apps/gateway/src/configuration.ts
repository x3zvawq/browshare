import {
  enumeration,
  integer,
  optionalText,
  optionalSecret,
  requiredText,
  secret,
  stringList,
  type Environment,
} from '@browshare/config'
import { isPublicId } from '@browshare/common'
import Type from 'typebox'
import { Value } from 'typebox/value'

const IceServerSchema = Type.Object(
  {
    urls: Type.Union([
      Type.String({ minLength: 1 }),
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    ]),
    username: Type.Optional(Type.String()),
    credential: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)
const IceServersSchema = Type.Array(IceServerSchema, { maxItems: 16 })
export interface GatewayConfiguration {
  readonly id: string
  readonly backendUrl: string
  readonly secret: string
  readonly publicEndpoint: string
  readonly host: string
  readonly port: number
  readonly healthHost: string
  readonly healthPort: number
  readonly iceServers: Type.Static<typeof IceServersSchema>
  readonly turn?: {
    readonly urls: readonly string[]
    readonly sharedSecret: string
    readonly credentialTtlSeconds: number
  }
  readonly iceTransportPolicy: 'all' | 'relay'
  readonly maxConnections: number
  readonly maxConnectionsPerIp: number
  readonly maxPendingPairs: number
}
export function loadGatewayConfiguration(
  environment: Environment = process.env,
): GatewayConfiguration {
  const id = requiredText(environment, 'BROWSHARE_GATEWAY_ID')
  if (!isPublicId(id)) throw new TypeError('BROWSHARE_GATEWAY_ID must be a UUIDv7')
  const backendUrl = requiredText(environment, 'BROWSHARE_GATEWAY_BACKEND_URL', { maxLength: 2048 })
  const publicEndpoint = requiredText(environment, 'BROWSHARE_GATEWAY_PUBLIC_ENDPOINT', {
    maxLength: 2048,
  })
  const backend = parseUrl(backendUrl),
    endpoint = parseUrl(publicEndpoint)
  if (
    backend.pathname !== '/' ||
    !['http:', 'https:'].includes(backend.protocol) ||
    (backend.protocol === 'http:' &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(backend.hostname))
  )
    throw new TypeError('Gateway Backend URL must be an HTTPS origin or loopback HTTP origin')
  if (endpoint.protocol !== 'wss:') throw new TypeError('Gateway public endpoint must use wss://')
  let iceServers: unknown
  try {
    iceServers = JSON.parse(optionalText(environment, 'BROWSHARE_GATEWAY_ICE_SERVERS_JSON') ?? '[]')
  } catch {
    throw new TypeError('Gateway ICE servers must be valid JSON')
  }
  if (!Value.Check(IceServersSchema, iceServers))
    throw new TypeError('Gateway ICE servers are invalid')
  const turnSecret = optionalSecret(environment, 'TURN_SHARED_SECRET', {
    minLength: 32,
    maxLength: 4096,
  })
  const turnUrls = stringList(environment, 'BROWSHARE_GATEWAY_TURN_URLS')
  const turnConfigured = turnSecret !== undefined || turnUrls.length > 0
  if (turnConfigured && (turnSecret === undefined || turnUrls.length === 0))
    throw new TypeError('Gateway dynamic TURN requires both URLs and TURN_SHARED_SECRET')
  if (turnConfigured && iceServers.length > 0)
    throw new TypeError(
      'Gateway dynamic TURN and nonempty static ICE servers are mutually exclusive',
    )
  if (!turnConfigured && environment.BROWSHARE_GATEWAY_TURN_CREDENTIAL_TTL_SECONDS !== undefined)
    throw new TypeError('Gateway TURN credential lifetime requires dynamic TURN configuration')
  if (turnUrls.length > 16) throw new TypeError('Gateway TURN supports at most 16 URLs')
  for (const url of turnUrls) assertTurnUrl(url)
  const credentialTtlSeconds = integer(
    environment,
    'BROWSHARE_GATEWAY_TURN_CREDENTIAL_TTL_SECONDS',
    {
      defaultValue: 3600,
      minimum: 60,
      maximum: 86400,
    },
  )
  return {
    id,
    backendUrl: backend.origin,
    publicEndpoint,
    secret: secret(environment, 'BROWSHARE_GATEWAY_SECRET', { minLength: 32, maxLength: 4096 }),
    host: optionalText(environment, 'BROWSHARE_GATEWAY_HOST') ?? '127.0.0.1',
    port: integer(environment, 'BROWSHARE_GATEWAY_PORT', {
      defaultValue: 3481,
      minimum: 0,
      maximum: 65535,
    }),
    healthHost: optionalText(environment, 'BROWSHARE_GATEWAY_HEALTH_HOST') ?? '127.0.0.1',
    healthPort: integer(environment, 'BROWSHARE_GATEWAY_HEALTH_PORT', {
      defaultValue: 3482,
      minimum: 0,
      maximum: 65535,
    }),
    iceServers,
    ...(turnSecret === undefined
      ? {}
      : { turn: { urls: turnUrls, sharedSecret: turnSecret, credentialTtlSeconds } }),
    iceTransportPolicy: enumeration(
      environment,
      'BROWSHARE_GATEWAY_ICE_TRANSPORT_POLICY',
      ['all', 'relay'],
      'all',
    ),
    maxConnections: integer(environment, 'BROWSHARE_GATEWAY_MAX_CONNECTIONS', {
      defaultValue: 2000,
      minimum: 2,
      maximum: 1000000,
    }),
    maxConnectionsPerIp: integer(environment, 'BROWSHARE_GATEWAY_MAX_CONNECTIONS_PER_IP', {
      defaultValue: 128,
      minimum: 2,
      maximum: 1000000,
    }),
    maxPendingPairs: integer(environment, 'BROWSHARE_GATEWAY_MAX_PENDING_PAIRS', {
      defaultValue: 1000,
      minimum: 1,
      maximum: 1000000,
    }),
  }
}
function assertTurnUrl(value: string): void {
  const match =
    /^(turns?):(\[[^\]]+\]|[^:/?#@\s]+)(?::([0-9]{1,5}))?(?:\?transport=(udp|tcp))?$/.exec(value)
  if (!match || value.length > 2048) throw new TypeError('Gateway TURN URL is invalid')
  const port = match[3] === undefined ? undefined : Number(match[3])
  if (port !== undefined && (port < 1 || port > 65535))
    throw new TypeError('Gateway TURN URL port is invalid')
  try {
    // URL validates IPv6 and host syntax; TURN itself uses opaque URI syntax.
    const authority = new URL(`http://${match[2]}${port === undefined ? '' : ':' + port}`)
    if (!authority.hostname) throw new Error('Missing host')
  } catch {
    throw new TypeError('Gateway TURN URL host is invalid')
  }
}
function parseUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('Gateway URL is invalid')
  }
  if (url.username || url.password || url.search || url.hash)
    throw new TypeError('Gateway URLs cannot contain credentials, query or fragment')
  return url
}
