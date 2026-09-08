#!/usr/bin/env node
import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'

const options = parseArguments(process.argv.slice(2))
const outputDirectory = resolve(options.output)
const privateKeyPath = join(outputDirectory, 'worker-ca-private-key.pem')
const certificatePath = join(outputDirectory, 'worker-ca-certificate.pem')

await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
await assertMissing(privateKeyPath)
await assertMissing(certificatePath)

const temporaryDirectory = await mkdtemp(join(outputDirectory, '.worker-ca-'))
const temporaryPrivateKeyPath = join(temporaryDirectory, 'private-key.pem')
const temporaryCertificatePath = join(temporaryDirectory, 'certificate.pem')

try {
  await runOpenSsl([
    'ecparam',
    '-name',
    'prime256v1',
    '-genkey',
    '-noout',
    '-out',
    temporaryPrivateKeyPath,
  ])
  await chmod(temporaryPrivateKeyPath, 0o600)
  await runOpenSsl([
    'req',
    '-x509',
    '-new',
    '-sha256',
    '-key',
    temporaryPrivateKeyPath,
    '-out',
    temporaryCertificatePath,
    '-days',
    String(options.days),
    '-subj',
    `/CN=${escapeSubjectValue(options.commonName)}`,
    '-addext',
    'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
    '-addext',
    'subjectKeyIdentifier=hash',
  ])
  await runOpenSsl(['pkey', '-in', temporaryPrivateKeyPath, '-check', '-noout'])
  await runOpenSsl(['x509', '-in', temporaryCertificatePath, '-checkend', '86400', '-noout'])
  await chmod(temporaryCertificatePath, 0o644)
  await rename(temporaryPrivateKeyPath, privateKeyPath)
  await rename(temporaryCertificatePath, certificatePath)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'created',
      certificate: certificatePath,
      privateKey: privateKeyPath,
      validityDays: options.days,
    },
    null,
    2,
  )}\n`,
)

function parseArguments(arguments_) {
  let output
  let commonName = 'BrowShare Worker CA'
  let days = 3650
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--output' && value !== undefined) {
      output = value
      index += 1
    } else if (argument === '--common-name' && value !== undefined) {
      commonName = value
      index += 1
    } else if (argument === '--days' && value !== undefined) {
      days = Number(value)
      index += 1
    } else {
      throw new TypeError(`Unknown or incomplete argument: ${argument}`)
    }
  }
  if (output === undefined || output.length === 0) {
    throw new TypeError('--output is required')
  }
  if (!Number.isSafeInteger(days) || days < 365 || days > 36500) {
    throw new RangeError('--days must be an integer between 365 and 36500')
  }
  if (commonName.length < 1 || commonName.length > 64 || /[/\r\n]/u.test(commonName)) {
    throw new TypeError('--common-name must contain 1 to 64 characters without slash or newlines')
  }
  return { output, commonName, days }
}

async function assertMissing(path) {
  try {
    await access(path, constants.F_OK)
  } catch (cause) {
    if (cause && typeof cause === 'object' && cause.code === 'ENOENT') return
    throw cause
  }
  throw new Error(`Refusing to overwrite existing CA material: ${path}`)
}

async function runOpenSsl(arguments_) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('openssl', arguments_, { stdio: ['ignore', 'pipe', 'pipe'] })
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

function escapeSubjectValue(value) {
  return value.replace(/([+<>,;=])/gu, '\\$1')
}
