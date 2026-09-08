#!/usr/bin/env node
import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const options = parseArguments(process.argv.slice(2))
const outputDirectory = resolve(options.output)
const outputs = {
  caPrivateKey: join(outputDirectory, 'control-tls-ca-private-key.pem'),
  caCertificate: join(outputDirectory, 'control-tls-ca-certificate.pem'),
  serverPrivateKey: join(outputDirectory, 'control-tls-private-key.pem'),
  serverCertificate: join(outputDirectory, 'control-tls-certificate.pem'),
}

await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
for (const path of Object.values(outputs)) await assertMissing(path)
const temporaryDirectory = await mkdtemp(join(outputDirectory, '.control-tls-'))
const temporary = {
  caPrivateKey: join(temporaryDirectory, 'ca-private-key.pem'),
  caCertificate: join(temporaryDirectory, 'ca-certificate.pem'),
  serverPrivateKey: join(temporaryDirectory, 'server-private-key.pem'),
  serverCertificateRequest: join(temporaryDirectory, 'server.csr'),
  serverCertificate: join(temporaryDirectory, 'server-certificate.pem'),
}

try {
  await runOpenSsl([
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:P-256',
    '-nodes',
    '-sha256',
    '-days',
    '3650',
    '-subj',
    '/CN=BrowShare Development Control TLS CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
    '-keyout',
    temporary.caPrivateKey,
    '-out',
    temporary.caCertificate,
  ])
  await runOpenSsl([
    'genpkey',
    '-algorithm',
    'EC',
    '-pkeyopt',
    'ec_paramgen_curve:P-256',
    '-out',
    temporary.serverPrivateKey,
  ])
  await runOpenSsl([
    'req',
    '-new',
    '-key',
    temporary.serverPrivateKey,
    '-subj',
    `/CN=${options.hostname}`,
    '-addext',
    `subjectAltName=${subjectAlternativeNames(options.hostname)}`,
    '-addext',
    'extendedKeyUsage=serverAuth',
    '-addext',
    'keyUsage=critical,digitalSignature',
    '-out',
    temporary.serverCertificateRequest,
  ])
  await runOpenSsl([
    'x509',
    '-req',
    '-in',
    temporary.serverCertificateRequest,
    '-CA',
    temporary.caCertificate,
    '-CAkey',
    temporary.caPrivateKey,
    '-CAcreateserial',
    '-days',
    String(options.days),
    '-sha256',
    '-copy_extensions',
    'copy',
    '-out',
    temporary.serverCertificate,
  ])
  await runOpenSsl([
    'verify',
    '-CAfile',
    temporary.caCertificate,
    '-purpose',
    'sslserver',
    '-verify_hostname',
    options.hostname,
    temporary.serverCertificate,
  ])
  await chmod(temporary.caPrivateKey, 0o600)
  await chmod(temporary.serverPrivateKey, 0o600)
  await chmod(temporary.caCertificate, 0o644)
  await chmod(temporary.serverCertificate, 0o644)
  await rename(temporary.caPrivateKey, outputs.caPrivateKey)
  await rename(temporary.caCertificate, outputs.caCertificate)
  await rename(temporary.serverPrivateKey, outputs.serverPrivateKey)
  await rename(temporary.serverCertificate, outputs.serverCertificate)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'created',
      hostname: options.hostname,
      validityDays: options.days,
      ...outputs,
    },
    null,
    2,
  )}\n`,
)

function parseArguments(arguments_) {
  let output
  let hostname = 'localhost'
  let days = 30
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--output' && value !== undefined) {
      output = value
      index += 1
    } else if (argument === '--hostname' && value !== undefined) {
      hostname = value.toLowerCase()
      index += 1
    } else if (argument === '--days' && value !== undefined) {
      days = Number(value)
      index += 1
    } else {
      throw new TypeError(`Unknown or incomplete argument: ${argument}`)
    }
  }
  if (output === undefined || output.length === 0) throw new TypeError('--output is required')
  if (!Number.isSafeInteger(days) || days < 1 || days > 398) {
    throw new RangeError('--days must be an integer between 1 and 398')
  }
  if (
    hostname.length < 1 ||
    hostname.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      hostname,
    )
  ) {
    throw new TypeError('--hostname must be a valid DNS hostname')
  }
  return { output, hostname, days }
}

function subjectAlternativeNames(hostname) {
  return hostname === 'localhost' ? 'DNS:localhost,IP:127.0.0.1,IP:::1' : `DNS:${hostname}`
}

async function assertMissing(path) {
  try {
    await access(path, constants.F_OK)
  } catch (cause) {
    if (cause && typeof cause === 'object' && cause.code === 'ENOENT') return
    throw cause
  }
  throw new Error(`Refusing to overwrite existing TLS material: ${path}`)
}

async function runOpenSsl(arguments_) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('openssl', arguments_, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 16_384) stderr += chunk
    })
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      rejectPromise(
        new Error(
          `OpenSSL failed (${signal === null ? `exit ${String(code)}` : `signal ${signal}`}): ${stderr.trim()}`,
        ),
      )
    })
  })
}
