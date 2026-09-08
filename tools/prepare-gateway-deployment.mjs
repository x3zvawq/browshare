#!/usr/bin/env node
import { randomBytes, X509Certificate, createPrivateKey } from 'node:crypto'
import { chown, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = {}
const names = [
  '--output',
  '--hostname',
  '--https-port',
  '--backend-url',
  '--backend-ca-file',
  '--certificate',
  '--private-key',
  '--gateway-image',
  '--ingress-image',
  '--turn-secret-file',
  '--turn-urls',
  '--turn-ttl',
  '--ice-policy',
  '--project',
  '--bind-address',
]
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index],
    value = process.argv[index + 1]
  if (!names.includes(key) || !value || options[key] !== undefined)
    throw new Error('Unknown, repeated or incomplete Gateway deployment argument')
  if (/[\r\n\0]/u.test(value))
    throw new Error('Gateway deployment arguments must be single-line values')
  options[key] = value
}
for (const key of [
  '--output',
  '--hostname',
  '--backend-url',
  '--backend-ca-file',
  '--certificate',
  '--private-key',
  '--gateway-image',
  '--ingress-image',
  '--turn-secret-file',
  '--turn-urls',
])
  if (!options[key]) throw new Error(`${key} is required`)
const hostname = options['--hostname']
if (
  !(
    isIP(hostname) === 4 ||
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/u.test(hostname)
  ) ||
  hostname.length > 253
)
  throw new Error('Gateway hostname requires a DNS name or IPv4 address')
const port = Number(options['--https-port'] ?? 8443)
if (!Number.isInteger(port) || (port !== 443 && port < 1024) || port > 65535 || port === 8080)
  throw new Error('HTTPS port must be 443 or 1024-65535 except the internal health port 8080')
const listenPort = port === 443 ? 8443 : port
const backend = new URL(options['--backend-url'])
if (
  backend.protocol !== 'https:' ||
  backend.username ||
  backend.password ||
  backend.search ||
  backend.hash ||
  backend.pathname !== '/'
)
  throw new Error('Backend URL must be an HTTPS origin without credentials, query or fragment')
const project = options['--project'] ?? 'browshare-gateway'
if (!/^[a-z0-9][a-z0-9_-]*$/u.test(project)) throw new Error('Invalid Compose project name')
const bindAddress = options['--bind-address'] ?? '127.0.0.1'
if (!['127.0.0.1', '0.0.0.0'].includes(bindAddress))
  throw new Error('Bind address must be 127.0.0.1 or 0.0.0.0')
for (const key of ['--gateway-image', '--ingress-image'])
  if (/\s/u.test(options[key])) throw new Error('Image references must not contain whitespace')
const ttl = Number(options['--turn-ttl'] ?? 3600)
if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400)
  throw new Error('TURN lifetime must be 60-86400 seconds')
const policy = options['--ice-policy'] ?? 'all'
if (!['all', 'relay'].includes(policy)) throw new Error('ICE policy must be all or relay')
const turnUrls = options['--turn-urls'].split(',').map((value) => value.trim())
if (turnUrls.length > 16 || turnUrls.some((value) => !validTurnUrl(value)))
  throw new Error('TURN URLs must contain 1-16 valid comma-separated turn/turns URLs')
const certificate = await readFile(resolve(options['--certificate']))
const privateKey = await readFile(resolve(options['--private-key']))
const backendCa = await readFile(resolve(options['--backend-ca-file']))
const turnSecret = (await readFile(resolve(options['--turn-secret-file']), 'utf8')).trim()
if (turnSecret.length < 32 || turnSecret.length > 4096 || /[\r\n\0]/u.test(turnSecret))
  throw new Error('TURN shared Secret must be 32-4096 characters in a single line')
const leaf = new X509Certificate(certificate)
if (
  !(isIP(hostname) ? leaf.checkIP(hostname) : leaf.checkHost(hostname)) ||
  !leaf.checkPrivateKey(createPrivateKey(privateKey))
)
  throw new Error('Gateway certificate must match its advertised hostname and private key')
if (Date.parse(leaf.validFrom) > Date.now() || Date.parse(leaf.validTo) <= Date.now())
  throw new Error('Gateway certificate is not currently valid')
new X509Certificate(backendCa)
const output = resolve(options['--output'])
const uid = process.getuid?.() === 0 ? 1000 : (process.getuid?.() ?? 1000)
const gid = process.getuid?.() === 0 ? 1000 : (process.getgid?.() ?? 1000)
const gatewayId = uuidV7(),
  gatewaySecret = randomBytes(32).toString('base64url')
const origin = `https://${hostname}:${port}`
const entry = {
  id: gatewayId,
  publicEndpoint: origin.replace('https:', 'wss:') + '/signal/',
  healthUrl: origin + '/health/ready',
  secret: gatewaySecret,
}
// Reserve a new directory only after validating inputs. Never replace an installed identity or registry.
await mkdir(dirname(output), { recursive: true })
await mkdir(output, { mode: 0o700 })
await mkdir(join(output, 'secrets'), { mode: 0o700 })
await mkdir(join(output, 'tls'), { mode: 0o700 })
for (const [path, content] of [
  ['secrets/gateway_secret', gatewaySecret + '\n'],
  ['secrets/turn_shared_secret', turnSecret + '\n'],
  ['secrets/gateway_registry.json', JSON.stringify([entry], null, 2) + '\n'],
  ['tls/gateway-certificate.pem', certificate],
  ['tls/gateway-private-key.pem', privateKey],
  ['tls/backend-ca-certificate.pem', backendCa],
])
  await save(path, content, true)
await save(
  'gateway.env',
  encode({
    BROWSHARE_GATEWAY_ID: gatewayId,
    BROWSHARE_GATEWAY_HOST: '0.0.0.0',
    BROWSHARE_GATEWAY_HEALTH_HOST: '0.0.0.0',
    BROWSHARE_GATEWAY_BACKEND_URL: backend.origin,
    BROWSHARE_GATEWAY_PUBLIC_ENDPOINT: entry.publicEndpoint,
    BROWSHARE_GATEWAY_SECRET_FILE: '/run/secrets/gateway_secret',
    NODE_EXTRA_CA_CERTS: '/run/secrets/backend_ca_certificate',
    TURN_SHARED_SECRET_FILE: '/run/secrets/turn_shared_secret',
    BROWSHARE_GATEWAY_TURN_URLS: turnUrls.join(','),
    BROWSHARE_GATEWAY_TURN_CREDENTIAL_TTL_SECONDS: ttl,
    BROWSHARE_GATEWAY_ICE_TRANSPORT_POLICY: policy,
  }),
)
await save(
  '.env',
  encode({
    BROWSHARE_COMPOSE_PROJECT: project,
    BROWSHARE_DEPLOYMENT_DIRECTORY: output,
    BROWSHARE_HTTPS_PORT: port,
    BROWSHARE_HTTPS_LISTEN_PORT: listenPort,
    BROWSHARE_BIND_ADDRESS: bindAddress,
    BROWSHARE_RUNTIME_UID: uid,
    BROWSHARE_RUNTIME_GID: gid,
    BROWSHARE_GATEWAY_IMAGE: options['--gateway-image'],
    BROWSHARE_INGRESS_IMAGE: options['--ingress-image'],
  }),
)
const template = await readFile(join(root, 'deploy/docker/gateway-ingress.conf.template'), 'utf8')
await save(
  'ingress.conf',
  template
    .replaceAll('__HTTPS_LISTEN_PORT__', String(listenPort))
    .replaceAll('__HOSTNAME__', hostname),
  true,
)
process.stdout.write(
  JSON.stringify(
    {
      status: 'prepared',
      directory: output,
      gatewayId,
      publicEndpoint: entry.publicEndpoint,
      healthUrl: entry.healthUrl,
      registryFile: join(output, 'secrets/gateway_registry.json'),
      instructions:
        'Merge the private registry entry into Backend gateway configuration and trust this ingress CA before starting. No Backend files were changed.',
    },
    null,
    2,
  ) + '\n',
)

async function save(path, content, runtime = false) {
  const target = join(output, path)
  await writeFile(target, content, { mode: 0o600, flag: 'wx' })
  if (runtime && process.getuid?.() === 0) await chown(target, uid, gid)
}
function encode(values) {
  return (
    Object.entries(values)
      .map(([key, value]) => `${key}='${String(value).replaceAll("'", "\\'")}'`)
      .join('\n') + '\n'
  )
}
function uuidV7() {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Date.now(), 0, 6)
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
function validTurnUrl(value) {
  const match =
    /^(turns?):(\[[^\]]+\]|[^:/?#@\s]+)(?::([0-9]{1,5}))?(?:\?transport=(udp|tcp))?$/.exec(value)
  if (!match || value.length > 2048) return false
  const port = match[3] === undefined ? undefined : Number(match[3])
  if (port !== undefined && (port < 1 || port > 65535)) return false
  try {
    return Boolean(new URL(`http://${match[2]}${port === undefined ? '' : ':' + port}`).hostname)
  } catch {
    return false
  }
}
