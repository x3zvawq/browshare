#!/usr/bin/env node
import { randomBytes, X509Certificate, createPrivateKey } from 'node:crypto'
import { chmod, chown, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isIPv4 } from 'node:net'
import { resolve, join, dirname } from 'node:path'
import { parseEnv } from 'node:util'

const options = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index],
    value = process.argv[index + 1]
  if (
    ![
      '--directory',
      '--mode',
      '--project',
      '--public-address',
      '--hostname',
      '--certificate',
      '--private-key',
      '--port',
      '--tls-port',
      '--relay-min-port',
      '--relay-max-port',
    ].includes(key) ||
    !value ||
    options[key] !== undefined
  )
    throw new Error('Unknown or incomplete TURN deployment argument')
  options[key] = value
}
for (const key of ['--directory', '--public-address', '--certificate', '--private-key'])
  if (!options[key]) throw new Error(`${key} is required`)
const directory = resolve(options['--directory'])
const mode = options['--mode'] ?? 'integrated'
if (!['integrated', 'standalone'].includes(mode))
  throw new Error('TURN mode must be integrated or standalone')
if (mode === 'integrated' && options['--project'])
  throw new Error('--project is only used by standalone TURN')
const standalone = mode === 'standalone'
const project = options['--project'] ?? 'browshare-turn'
if (!/^[a-z0-9][a-z0-9_-]*$/u.test(project)) throw new Error('Invalid Compose project name')
if (/[\r\n\0]/u.test(directory)) throw new Error('Deployment directory must not contain newlines')
const environment = standalone ? {} : parseEnv(await readFile(join(directory, '.env'), 'utf8'))
const gateway = standalone ? {} : parseEnv(await readFile(join(directory, 'gateway.env'), 'utf8'))
if (
  gateway.TURN_SHARED_SECRET ||
  gateway.TURN_SHARED_SECRET_FILE ||
  gateway.BROWSHARE_GATEWAY_TURN_URLS ||
  (gateway.BROWSHARE_GATEWAY_ICE_SERVERS_JSON &&
    gateway.BROWSHARE_GATEWAY_ICE_SERVERS_JSON !== '[]')
)
  throw new Error('Gateway already has ICE configuration; review it before installing TURN')
const address = options['--public-address'],
  hostname = options['--hostname'] ?? address
if (!isIPv4(address) || !/^[a-z0-9.-]+$/u.test(hostname))
  throw new Error('TURN requires a public IPv4 address and valid advertised hostname')
const port = Number(options['--port'] ?? 3478),
  tlsPort = Number(options['--tls-port'] ?? 5349)
const minimum = Number(options['--relay-min-port'] ?? 49160),
  maximum = Number(options['--relay-max-port'] ?? 49223)
const ingressPorts = ['BROWSHARE_HTTPS_PORT', 'BROWSHARE_CONTROL_PORT', 'BROWSHARE_FILES_PORT'].map(
  (key) => Number(environment[key]),
)
if (
  [port, minimum, maximum].some(
    (value) => !Number.isInteger(value) || value < 1024 || value > 65535,
  ) ||
  !Number.isInteger(tlsPort) ||
  (tlsPort < 1024 && !(standalone && tlsPort === 443)) ||
  tlsPort > 65535 ||
  minimum > maximum ||
  port === tlsPort ||
  [port, tlsPort, ...ingressPorts].some((value) => value >= minimum && value <= maximum) ||
  ingressPorts.includes(port) ||
  ingressPorts.includes(tlsPort)
)
  throw new Error('TURN listening and relay ports must be distinct from deployment ports')
const certificate = await readFile(resolve(options['--certificate'])),
  privateKey = await readFile(resolve(options['--private-key']))
const leaf = new X509Certificate(certificate)
if (
  !(isIPv4(hostname) ? leaf.checkIP(hostname) : leaf.checkHost(hostname)) ||
  !leaf.checkPrivateKey(createPrivateKey(privateKey))
)
  throw new Error('TURN certificate must match its advertised host and private key')
if (
  standalone &&
  (Date.parse(leaf.validFrom) > Date.now() || Date.parse(leaf.validTo) <= Date.now())
)
  throw new Error('TURN certificate is not currently valid')
const secret = randomBytes(32).toString('base64url')
if (standalone) {
  // A standalone node owns only its own directory and never reads a control-plane installation.
  await mkdir(dirname(directory), { recursive: true })
  await mkdir(directory, { mode: 0o700 })
  await mkdir(join(directory, 'secrets'), { mode: 0o700 })
}
await mkdir(join(directory, 'turn'), { mode: 0o700 })
await save(join(directory, 'turn/tls-certificate.pem'), certificate, 65534)
await save(join(directory, 'turn/tls-private-key.pem'), privateKey, 65534)
await save(
  join(directory, 'secrets/turn_shared_secret'),
  secret + '\n',
  standalone ? (process.getuid?.() ?? 1000) : Number(environment.BROWSHARE_RUNTIME_UID ?? 1000),
)
await save(
  join(directory, 'secrets/turn_configuration'),
  [
    `listening-port=${port}`,
    `tls-listening-port=${tlsPort}`,
    'listening-ip=0.0.0.0',
    `relay-ip=${address}`,
    `min-port=${minimum}`,
    `max-port=${maximum}`,
    `realm=${hostname}`,
    'use-auth-secret',
    `static-auth-secret=${secret}`,
    'cert=/run/secrets/turn_certificate',
    'pkey=/run/secrets/turn_private_key',
    'no-tlsv1',
    'no-tlsv1_1',
    'no-dtls',
    'fingerprint',
    'no-cli',
    'no-multicast-peers',
    'no-tcp-relay',
    'no-rfc5780',
    'no-stun-backward-compatibility',
    'relay-threads=2',
    'pidfile=/tmp/turnserver.pid',
    'log-file=stdout',
    'simple-log',
    // Browser peers need UDP relay allocations even when their client transport is TCP/TLS.
    'user-quota=12',
    'total-quota=256',
  ].join('\n') + '\n',
  65534,
)
const turnUrls = `turn:${hostname}:${port}?transport=udp,turn:${hostname}:${port}?transport=tcp,turns:${hostname}:${tlsPort}?transport=tcp`
if (standalone) {
  await writeFile(
    join(directory, '.env'),
    encode({
      BROWSHARE_COMPOSE_PROJECT: project,
      BROWSHARE_DEPLOYMENT_DIRECTORY: directory,
      BROWSHARE_TURN_URLS: turnUrls,
    }),
    { flag: 'wx', mode: 0o600 },
  )
} else {
  gateway.TURN_SHARED_SECRET_FILE = '/run/secrets/turn_shared_secret'
  gateway.BROWSHARE_GATEWAY_TURN_URLS = turnUrls
  await writeFile(join(directory, 'gateway.env'), encode(gateway))
}
process.stdout.write(
  JSON.stringify({
    status: 'prepared',
    mode,
    directory,
    hostname,
    listeningPorts: [port, tlsPort],
    relayPorts: [minimum, maximum],
    transport: 'UDP/TCP/TLS',
    hostNetwork: true,
    ...(standalone
      ? { turnUrls, sharedSecretFile: join(directory, 'secrets/turn_shared_secret') }
      : {}),
  }) + '\n',
)

async function save(path, content, uid) {
  await writeFile(path, content, { flag: 'wx', mode: 0o600 })
  if (process.getuid?.() === 0) await chown(path, uid, uid)
  else if (process.getuid?.() !== uid) await chmod(path, 0o444)
}

function encode(values) {
  return (
    Object.entries(values)
      .map(([key, value]) => `${key}='${String(value).replaceAll("'", "\\'")}'`)
      .join('\n') + '\n'
  )
}
