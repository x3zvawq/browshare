#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { chmod, chown, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { renderDeploymentIngress } from './render-deployment-ingress.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = parseArguments(process.argv.slice(2))
const output = resolve(options.output)
await mkdir(dirname(output), { recursive: true })
// A new deployment gets new identities and secrets. Never reset an existing installation.
await mkdir(output, { mode: 0o700 })
await mkdir(join(output, 'secrets'), { mode: 0o700 })
const uid = process.getuid?.() === 0 ? 1000 : (process.getuid?.() ?? 1000)
const gid = process.getuid?.() === 0 ? 1000 : (process.getgid?.() ?? 1000)
const origin = `https://${options.hostname}:${options.httpsPort}`
const gatewayId = uuidV7()
const gatewaySecret = randomBytes(32).toString('base64url')
const databasePassword = randomBytes(32).toString('base64url')
for (const [name, contents] of Object.entries({
  postgres_password: databasePassword,
  database_url: `postgres://browshare:${databasePassword}@postgres:5432/browshare`,
  session_secret: randomBytes(48).toString('base64url'),
  bootstrap_token: randomBytes(32).toString('base64url'),
  gateway_secret: gatewaySecret,
  gateway_registry: JSON.stringify([
    {
      id: gatewayId,
      publicEndpoint: `${origin.replace('https:', 'wss:')}/signal/`,
      healthUrl: `https://${options.hostname}:8444/health/ready`,
      secret: gatewaySecret,
    },
  ]),
})) {
  const path = join(output, 'secrets', name)
  await writeFile(path, contents + '\n', { mode: 0o600, flag: 'wx' })
  await runtimeOwnership(path)
}
// PostgreSQL drops to its image UID before reading the mounted file. The host parent remains 0700;
// only this one secret is mounted in that container, not the containing directory.
await chmod(join(output, 'secrets/postgres_password'), 0o444)
execFileSync(
  process.execPath,
  [join(root, 'tools/generate-worker-ca.mjs'), '--output', join(output, 'worker-ca')],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
execFileSync(
  process.execPath,
  [
    join(root, 'tools/generate-development-control-tls.mjs'),
    '--output',
    join(output, 'tls'),
    '--hostname',
    options.hostname,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
for (const path of ['worker-ca/worker-ca-private-key.pem', 'tls/control-tls-private-key.pem']) {
  await runtimeOwnership(join(output, path))
}
const backend = {
  BROWSHARE_BACKEND_HOST: '0.0.0.0',
  BROWSHARE_BACKEND_ALLOWED_ORIGINS: origin,
  DATABASE_URL_FILE: '/run/secrets/database_url',
  BROWSHARE_SESSION_SECRET_FILE: '/run/secrets/session_secret',
  BOOTSTRAP_TOKEN_FILE: '/run/secrets/bootstrap_token',
  BROWSHARE_COOKIE_SECURE: 'true',
  BROWSHARE_GATEWAYS_JSON_FILE: '/run/secrets/gateway_registry',
  BROWSHARE_WORKER_CONTROL_HOST: '0.0.0.0',
  BROWSHARE_WORKER_CONTROL_URL: `wss://${options.hostname}:${options.controlPort}/control`,
  BROWSHARE_WORKER_CONTROL_TLS_CERTIFICATE_FILE: '/run/secrets/tls_certificate',
  BROWSHARE_WORKER_CONTROL_TLS_PRIVATE_KEY_FILE: '/run/secrets/tls_private_key',
  BROWSHARE_WORKER_CA_CERTIFICATE_FILE: '/run/secrets/worker_ca_certificate',
  BROWSHARE_WORKER_CA_PRIVATE_KEY_FILE: '/run/secrets/worker_ca_private_key',
  NODE_EXTRA_CA_CERTS: '/run/secrets/tls_ca_certificate',
}
const gateway = {
  BROWSHARE_GATEWAY_ID: gatewayId,
  BROWSHARE_GATEWAY_HOST: '0.0.0.0',
  BROWSHARE_GATEWAY_HEALTH_HOST: '0.0.0.0',
  BROWSHARE_GATEWAY_BACKEND_URL: origin,
  BROWSHARE_GATEWAY_PUBLIC_ENDPOINT: `${origin.replace('https:', 'wss:')}/signal/`,
  BROWSHARE_GATEWAY_SECRET_FILE: '/run/secrets/gateway_secret',
  NODE_EXTRA_CA_CERTS: '/run/secrets/tls_ca_certificate',
}
await writeEnvironment('backend.env', backend)
await writeEnvironment('gateway.env', gateway)
await writeEnvironment('.env', {
  BROWSHARE_COMPOSE_PROJECT: options.project,
  BROWSHARE_DEPLOYMENT_DIRECTORY: output,
  BROWSHARE_PUBLIC_HOSTNAME: options.hostname,
  BROWSHARE_HTTPS_PORT: options.httpsPort,
  BROWSHARE_CONTROL_PORT: options.controlPort,
  BROWSHARE_BIND_ADDRESS: options.bindAddress,
  BROWSHARE_RUNTIME_UID: uid,
  BROWSHARE_RUNTIME_GID: gid,
  ...Object.fromEntries(
    ['backend', 'migrator', 'gateway', 'portal'].map((service) => [
      `BROWSHARE_${service.toUpperCase()}_IMAGE`,
      `browshare/${service}:${options.tag}`,
    ]),
  ),
})
await renderDeploymentIngress(output)
process.stdout.write(
  JSON.stringify(
    {
      status: 'prepared',
      directory: output,
      origin,
      gatewayId,
      certificateAuthority: join(output, 'tls/control-tls-ca-certificate.pem'),
      bootstrapTokenFile: join(output, 'secrets/bootstrap_token'),
      instructions:
        'Trust the development CA and resolve the hostname to the Docker host. Start compose.control.yml with this .env; open /setup. Worker and TURN setup is separate.',
    },
    null,
    2,
  ) + '\n',
)

async function runtimeOwnership(path) {
  if (process.getuid?.() === 0) await chown(path, uid, gid)
}

async function writeEnvironment(name, values) {
  // Single-quoted Compose values preserve literal dollars and spaces in a directory path.
  const text =
    Object.entries(values)
      .map(([key, value]) => `${key}='${String(value).replaceAll("'", "\\'")}'`)
      .join('\n') + '\n'
  await writeFile(join(output, name), text, { flag: 'wx', mode: 0o600 })
}

function uuidV7() {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Date.now(), 0, 6)
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function parseArguments(args) {
  const options = {
    output: '',
    hostname: 'browshare.test',
    httpsPort: 8443,
    controlPort: 8445,
    bindAddress: '127.0.0.1',
    project: 'browshare-dev',
    tag: 'local',
  }
  const names = {
    '--output': 'output',
    '--hostname': 'hostname',
    '--https-port': 'httpsPort',
    '--control-port': 'controlPort',
    '--bind-address': 'bindAddress',
    '--project': 'project',
    '--tag': 'tag',
  }
  for (let index = 0; index < args.length; index += 2) {
    const name = names[args[index]],
      value = args[index + 1]
    if (name === undefined || value === undefined) throw new Error('Unknown or incomplete argument')
    options[name] = ['httpsPort', 'controlPort'].includes(name) ? Number(value) : value
  }
  if (!options.output || /[\r\n]/u.test(options.output))
    throw new Error('--output is required and cannot contain newlines')
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/u.test(options.hostname) ||
    options.hostname.length > 253
  )
    throw new Error('--hostname requires a DNS hostname with a domain, for example browshare.test')
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(options.project))
    throw new Error('Invalid Compose project name')
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/u.test(options.tag))
    throw new Error('Invalid image tag')
  if (!['127.0.0.1', '0.0.0.0'].includes(options.bindAddress))
    throw new Error('--bind-address must be 127.0.0.1 or 0.0.0.0')
  for (const port of [options.httpsPort, options.controlPort]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8080 || port === 8444)
      throw new Error('Ports must be 1024-65535, excluding internal 8080 and 8444')
  }
  if (options.httpsPort === options.controlPort)
    throw new Error('HTTPS and control ports must differ')
  return options
}
