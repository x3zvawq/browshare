#!/usr/bin/env node
import { createHash, randomBytes, X509Certificate, createPrivateKey } from 'node:crypto'
import { chmod, chown, mkdir, readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { isIP } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderDeploymentIngress } from './render-deployment-ingress.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const values = {}
for (let index = 0; index < args.length; index += 2) {
  const name = args[index],
    value = args[index + 1]
  if (
    ![
      '--directory',
      '--crx',
      '--extension-id',
      '--enrollment-token-file',
      '--image',
      '--name',
      '--files-port',
      '--backend-url',
      '--portal-origin',
      '--files-origin',
      '--server-ca',
      '--files-certificate',
      '--files-private-key',
      '--ingress-image',
      '--project',
      '--bind-address',
    ].includes(name) ||
    !value
  )
    throw new Error('Unknown or incomplete Worker deployment argument')
  values[name] = value
}
for (const name of [
  '--directory',
  '--crx',
  '--extension-id',
  '--enrollment-token-file',
  '--image',
]) {
  if (!values[name]) throw new Error(`${name} is required`)
}
if (!/^[a-p]{32}$/u.test(values['--extension-id'])) throw new Error('Invalid Extension ID')
const directory = resolve(values['--directory']),
  crxPath = resolve(values['--crx'])
const standalone = values['--backend-url'] !== undefined
let environment, origin, filesOrigin, serverCa, filesCertificate, filesPrivateKey
if (standalone) {
  for (const name of [
    '--files-origin',
    '--server-ca',
    '--files-certificate',
    '--files-private-key',
    '--ingress-image',
    '--project',
  ])
    if (!values[name]) throw new Error(`${name} is required for an independent Worker`)
  origin = httpsOrigin(values['--backend-url'])
  filesOrigin = httpsOrigin(values['--files-origin'])
  if (origin === filesOrigin) throw new Error('Worker files must use a separate origin')
  const files = new URL(filesOrigin)
  if (!/^[a-z0-9.-]+$/u.test(files.hostname) || !/^[a-z0-9][a-z0-9_-]*$/u.test(values['--project']))
    throw new Error('Invalid file hostname or Compose project name')
  environment = {
    BROWSHARE_COMPOSE_PROJECT: values['--project'],
    BROWSHARE_DEPLOYMENT_DIRECTORY: directory,
    BROWSHARE_PUBLIC_HOSTNAME: files.hostname,
    BROWSHARE_BIND_ADDRESS: values['--bind-address'] ?? '127.0.0.1',
    BROWSHARE_PORTAL_IMAGE: values['--ingress-image'],
    BROWSHARE_FILES_BIND_PORT: files.port || '443',
  }
  if (!['127.0.0.1', '0.0.0.0'].includes(environment.BROWSHARE_BIND_ADDRESS))
    throw new Error('Bind address must be 127.0.0.1 or 0.0.0.0')
  serverCa = await readFile(resolve(values['--server-ca']))
  filesCertificate = await readFile(resolve(values['--files-certificate']))
  filesPrivateKey = await readFile(resolve(values['--files-private-key']))
  const certificate = new X509Certificate(filesCertificate)
  if (
    !(isIP(files.hostname)
      ? certificate.checkIP(files.hostname)
      : certificate.checkHost(files.hostname)) ||
    !certificate.checkPrivateKey(createPrivateKey(filesPrivateKey))
  )
    throw new Error('File certificate must match its advertised hostname and private key')
  new X509Certificate(serverCa)
} else {
  environment = parseEnv(await readFile(join(directory, '.env'), 'utf8'))
  origin = `https://${environment.BROWSHARE_PUBLIC_HOSTNAME}:${environment.BROWSHARE_HTTPS_PORT}`
}
const filesPort = Number(values['--files-port'] ?? 8446)
if (
  !Number.isInteger(filesPort) ||
  filesPort < 1024 ||
  filesPort > 65535 ||
  [
    8080,
    8444,
    Number(environment.BROWSHARE_HTTPS_PORT),
    Number(environment.BROWSHARE_CONTROL_PORT),
  ].includes(filesPort)
)
  throw new Error('File port must be distinct and nonprivileged')
const compatibility = JSON.parse(await readFile(join(root, 'deploy/compatibility.json'), 'utf8'))
const crx = await readFile(crxPath)
if (crx.length < 12 || crx.subarray(0, 4).toString() !== 'Cr24' || crx.readUInt32LE(4) !== 3)
  throw new Error('Expected a signed CRX3 artifact')
const token = (await readFile(resolve(values['--enrollment-token-file']), 'utf8')).trim()
if (token.length < 40 || token.length > 128 || /[\r\n]/u.test(token))
  throw new Error('Invalid Enrollment Token file')
const name = values['--name'] ?? (standalone ? values['--project'] : 'all-in-one-worker')
if (name.length > 128 || /[\r\n]/u.test(name)) throw new Error('Invalid Worker name')
if (standalone) {
  await mkdir(dirname(directory), { recursive: true })
  await mkdir(directory, { mode: 0o700 })
  await mkdir(join(directory, 'secrets'), { mode: 0o700 })
  await mkdir(join(directory, 'tls'), { mode: 0o700 })
  await writeFile(join(directory, 'tls/control-tls-ca-certificate.pem'), serverCa, {
    mode: 0o644,
    flag: 'wx',
  })
  await writeFile(join(directory, 'tls/files-certificate.pem'), filesCertificate, {
    mode: 0o644,
    flag: 'wx',
  })
  const keyPath = join(directory, 'tls/files-private-key.pem')
  await writeFile(keyPath, filesPrivateKey, { mode: 0o600, flag: 'wx' })
  if (process.getuid?.() === 0) await chown(keyPath, 1000, 1000)
  else if (process.getuid?.() !== 1000) await chmod(keyPath, 0o444)
}
// Reserve the configuration before creating secrets; existing Worker setups are never replaced.
const workerPath = join(directory, 'worker.env')
await writeFile(workerPath, '', { mode: 0o600, flag: 'wx' })
await mkdir(join(directory, 'worker-enrollment'), { mode: 0o755 })
for (const [path, contents] of [
  [join(directory, 'secrets/remote_tab_runtime_secret'), randomBytes(32).toString('base64url')],
  [join(directory, 'worker-enrollment/token'), token],
]) {
  await writeFile(path, contents + '\n', { flag: 'wx', mode: 0o600 })
  // Only the selected file/directory is mounted; the deployment parent remains private on host.
  if (process.getuid?.() === 0) await chown(path, 1000, 1000)
  else if (process.getuid?.() !== 1000) await chmod(path, 0o444)
}
const worker = {
  BROWSHARE_WORKER_NAME: name,
  BROWSHARE_BACKEND_URL: origin,
  BROWSHARE_WORKER_ENROLLMENT_TOKEN_FILE: '/run/browshare-enrollment/token',
  BROWSHARE_WORKER_CONTROL_SERVER_CA_CERTIFICATE_FILE: '/run/secrets/tls_ca_certificate',
  NODE_EXTRA_CA_CERTS: '/run/secrets/tls_ca_certificate',
  BROWSHARE_REMOTE_TAB_ENABLED: 'true',
  BROWSHARE_REMOTE_TAB_EXTENSION_ID: values['--extension-id'],
  BROWSHARE_REMOTE_TAB_EXTENSION_CRX_SHA256: createHash('sha256').update(crx).digest('hex'),
  BROWSHARE_REMOTE_TAB_RUNTIME_SECRET_FILE: '/run/secrets/remote_tab_runtime_secret',
  BROWSHARE_WORKER_DOWNLOAD_ENDPOINT: `${filesOrigin ?? `https://${environment.BROWSHARE_PUBLIC_HOSTNAME}:${filesPort}`}/claim`,
  BROWSHARE_WORKER_DOWNLOAD_PORTAL_ORIGIN: values['--portal-origin']
    ? httpsOrigin(values['--portal-origin'])
    : origin,
  BROWSHARE_WORKER_DOWNLOAD_HOST: '0.0.0.0',
}
await writeFile(workerPath, encode(worker))
await writeFile(
  join(directory, '.env'),
  encode({
    ...environment,
    BROWSHARE_FILES_PORT: filesPort,
    BROWSHARE_WORKER_IMAGE: values['--image'],
    BROWSHARE_EXTENSION_CRX_FILE: crxPath,
    BROWSHARE_EXTENSION_CRX_NAME: compatibility.remoteTab.extension.artifactName,
  }),
)
if (standalone) {
  const source = await readFile(join(root, 'deploy/docker/files.conf.template'), 'utf8')
  await writeFile(
    join(directory, 'files.conf'),
    source
      .replaceAll('__HOSTNAME__', environment.BROWSHARE_PUBLIC_HOSTNAME)
      .replaceAll('__FILES_PORT__', String(filesPort)),
    { mode: 0o644, flag: 'wx' },
  )
} else await renderDeploymentIngress(directory)
process.stdout.write(
  JSON.stringify({
    status: 'prepared',
    directory,
    worker: name,
    extensionId: values['--extension-id'],
    crxSha256: worker.BROWSHARE_REMOTE_TAB_EXTENSION_CRX_SHA256,
    downloadEndpoint: worker.BROWSHARE_WORKER_DOWNLOAD_ENDPOINT,
  }) + '\n',
)

function encode(object) {
  return (
    Object.entries(object)
      .map(([key, value]) => {
        if (/[\r\n]/u.test(String(value))) throw new Error(`Invalid newline in ${key}`)
        return `${key}='${String(value).replaceAll("'", "\\'")}'`
      })
      .join('\n') + '\n'
  )
}

function httpsOrigin(value) {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Endpoint must be an HTTPS origin without credentials, path, query or fragment')
  return url.origin
}
