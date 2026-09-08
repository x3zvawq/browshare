import { createHash, createPrivateKey, generateKeyPairSync, X509Certificate } from 'node:crypto'
import {
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { isPublicId, utcNow } from '@browshare/common'
import {
  ApiErrorEnvelopeSchema,
  BROWSHARE_API_VERSION,
  BROWSHARE_VERSION,
  RegisterWorkerResponseSchema,
  RotateWorkerCredentialResponseSchema,
  type RegisterWorkerRequest,
  type RegisterWorkerResponse,
  type RotateWorkerCredentialRequest,
  type RotateWorkerCredentialResponse,
} from '@browshare/contracts'
import Type from 'typebox'
import { Value } from 'typebox/value'

import type { WorkerConfiguration } from './configuration.js'

const IDENTITY_FILE_NAME = 'worker-identity.json'
const ENROLLMENT_LOCK_DIRECTORY = '.enrollment-lock'
const ROTATION_LOCK_DIRECTORY = '.credential-rotation-lock'
const PRIVATE_FILE_MODE_MASK = 0o077

const StoredWorkerIdentitySchema = Type.Object(
  {
    version: Type.Literal(1),
    workerId: Type.String({ format: 'uuid' }),
    credentialId: Type.String({ format: 'uuid' }),
    privateKeyPem: Type.String({ minLength: 160, maxLength: 8_192 }),
    certificatePem: Type.String({ minLength: 256, maxLength: 16_384 }),
    caCertificatePem: Type.String({ minLength: 256, maxLength: 16_384 }),
    certificateSerial: Type.String({ minLength: 2, maxLength: 128 }),
    certificateFingerprintSha256: Type.String({ minLength: 64, maxLength: 95 }),
    certificateNotBefore: Type.String({ format: 'date-time' }),
    certificateExpiresAt: Type.String({ format: 'date-time' }),
    controlUrl: Type.String({ format: 'uri', minLength: 1, maxLength: 2_048 }),
    enrolledAt: Type.String({ format: 'date-time' }),
    lastRotationTokenDigest: Type.Optional(Type.String({ minLength: 64, maxLength: 64 })),
  },
  { additionalProperties: false },
)

export type StoredWorkerIdentity = Type.Static<typeof StoredWorkerIdentitySchema>

export interface EnsuredWorkerIdentity {
  readonly identity: StoredWorkerIdentity
  readonly outcome: 'loaded' | 'enrolled' | 'rotated'
}

export async function ensureWorkerIdentity(
  configuration: WorkerConfiguration,
): Promise<EnsuredWorkerIdentity> {
  const existing = await loadWorkerIdentity(configuration.identityDirectory)
  if (existing !== undefined) {
    if (configuration.credentialRotationToken === undefined) {
      return { identity: existing, outcome: 'loaded' }
    }
    if (
      existing.lastRotationTokenDigest ===
      digestRotationToken(configuration.credentialRotationToken)
    ) {
      return { identity: existing, outcome: 'loaded' }
    }
    const identity = await rotateWorkerIdentity(configuration, existing)
    return { identity, outcome: 'rotated' }
  }
  if (configuration.credentialRotationToken !== undefined) {
    throw new Error('Worker credential rotation requires an existing identity file')
  }
  if (configuration.enrollmentToken === undefined) {
    throw new Error(
      'Worker identity does not exist; set BROWSHARE_WORKER_ENROLLMENT_TOKEN or BROWSHARE_WORKER_ENROLLMENT_TOKEN_FILE',
    )
  }

  await prepareIdentityDirectory(configuration.identityDirectory)
  const lockDirectory = join(configuration.identityDirectory, ENROLLMENT_LOCK_DIRECTORY)
  try {
    await mkdir(lockDirectory, { mode: 0o700 })
  } catch (cause) {
    if (hasErrorCode(cause, 'EEXIST')) {
      throw new Error(
        `Worker enrollment is already in progress or requires manual recovery: ${lockDirectory}`,
        { cause },
      )
    }
    throw cause
  }

  try {
    const createdByAnotherProcess = await loadWorkerIdentity(configuration.identityDirectory)
    if (createdByAnotherProcess !== undefined) {
      return { identity: createdByAnotherProcess, outcome: 'loaded' }
    }
    const keys = generateWorkerKeyPair()
    const registration = await enrollWorker(configuration, keys.publicKeyPem)
    const identity: StoredWorkerIdentity = {
      version: 1,
      workerId: registration.workerId,
      credentialId: registration.credentialId,
      privateKeyPem: keys.privateKeyPem,
      certificatePem: registration.certificatePem,
      caCertificatePem: registration.caCertificatePem,
      certificateSerial: registration.certificateSerial,
      certificateFingerprintSha256: registration.certificateFingerprintSha256,
      certificateNotBefore: registration.certificateNotBefore,
      certificateExpiresAt: registration.certificateExpiresAt,
      controlUrl: registration.controlUrl,
      enrolledAt: utcNow(),
    }
    validateWorkerIdentity(identity)
    await persistWorkerIdentity(configuration.identityDirectory, identity)
    return { identity, outcome: 'enrolled' }
  } finally {
    await rm(lockDirectory, { recursive: true, force: true })
  }
}

async function rotateWorkerIdentity(
  configuration: WorkerConfiguration,
  existing: StoredWorkerIdentity,
): Promise<StoredWorkerIdentity> {
  const rotationToken = configuration.credentialRotationToken
  if (rotationToken === undefined) {
    throw new Error('Worker credential rotation token is unavailable')
  }
  await prepareIdentityDirectory(configuration.identityDirectory)
  const lockDirectory = join(configuration.identityDirectory, ROTATION_LOCK_DIRECTORY)
  try {
    await mkdir(lockDirectory, { mode: 0o700 })
  } catch (cause) {
    if (hasErrorCode(cause, 'EEXIST')) {
      throw new Error(
        `Worker credential rotation is already in progress or requires manual recovery: ${lockDirectory}`,
        { cause },
      )
    }
    throw cause
  }

  try {
    const current = await loadWorkerIdentity(configuration.identityDirectory)
    if (current === undefined) throw new Error('Worker identity disappeared during rotation')
    if (current.workerId !== existing.workerId || current.credentialId !== existing.credentialId) {
      throw new Error('Worker identity changed concurrently during credential rotation')
    }
    const keys = generateWorkerKeyPair()
    const rotation = await requestWorkerCredentialRotation(
      configuration,
      rotationToken,
      current,
      keys.publicKeyPem,
    )
    const identity: StoredWorkerIdentity = {
      version: 1,
      workerId: rotation.workerId,
      credentialId: rotation.credentialId,
      privateKeyPem: keys.privateKeyPem,
      certificatePem: rotation.certificatePem,
      caCertificatePem: rotation.caCertificatePem,
      certificateSerial: rotation.certificateSerial,
      certificateFingerprintSha256: rotation.certificateFingerprintSha256,
      certificateNotBefore: rotation.certificateNotBefore,
      certificateExpiresAt: rotation.certificateExpiresAt,
      controlUrl: rotation.controlUrl,
      enrolledAt: current.enrolledAt,
      lastRotationTokenDigest: digestRotationToken(rotationToken),
    }
    validateWorkerIdentity(identity)
    await replaceWorkerIdentity(configuration.identityDirectory, identity)
    return identity
  } finally {
    await rm(lockDirectory, { recursive: true, force: true })
  }
}

export async function loadWorkerIdentity(
  identityDirectory: string,
): Promise<StoredWorkerIdentity | undefined> {
  const identityPath = join(identityDirectory, IDENTITY_FILE_NAME)
  let fileStat
  try {
    fileStat = await lstat(identityPath)
  } catch (cause) {
    if (hasErrorCode(cause, 'ENOENT')) return undefined
    throw cause
  }
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`Worker identity path must be a regular file: ${identityPath}`)
  }
  if (process.platform !== 'win32' && (fileStat.mode & PRIVATE_FILE_MODE_MASK) !== 0) {
    throw new Error(`Worker identity file permissions must be 0600: ${identityPath}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(identityPath, 'utf8')) as unknown
  } catch (cause) {
    throw new Error(`Worker identity file is not valid JSON: ${identityPath}`, { cause })
  }
  if (!Value.Check(StoredWorkerIdentitySchema, parsed)) {
    throw new Error(`Worker identity file does not match version 1 schema: ${identityPath}`)
  }
  validateWorkerIdentity(parsed)
  return parsed
}

async function enrollWorker(
  configuration: WorkerConfiguration,
  publicKeyPem: string,
): Promise<RegisterWorkerResponse> {
  const request: RegisterWorkerRequest = {
    name: configuration.name,
    publicKeyPem,
    metadata: {
      hostname: hostname(),
      platform: process.platform,
      architecture: process.arch,
      workerVersion: BROWSHARE_VERSION,
    },
  }
  const endpoint = new URL(`/api/${BROWSHARE_API_VERSION}/workers/enroll`, configuration.backendUrl)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${configuration.enrollmentToken}`,
        'content-type': 'application/json',
        'user-agent': `BrowShare-Worker/${BROWSHARE_VERSION}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(configuration.enrollmentTimeoutMilliseconds),
    })
  } catch (cause) {
    throw new Error(`Worker enrollment request failed for ${endpoint.origin}`, { cause })
  }
  const bodyText = await response.text()
  if (bodyText.length > 131_072) {
    throw new Error('Worker enrollment response exceeds 128 KiB')
  }
  let body: unknown
  try {
    body = JSON.parse(bodyText) as unknown
  } catch (cause) {
    throw new Error(`Worker enrollment returned non-JSON HTTP ${response.status}`, { cause })
  }
  if (!response.ok) {
    if (Value.Check(ApiErrorEnvelopeSchema, body)) {
      throw new Error(`Worker enrollment rejected: ${body.error.code}: ${body.error.message}`)
    }
    throw new Error(`Worker enrollment rejected with HTTP ${response.status}`)
  }
  if (!Value.Check(RegisterWorkerResponseSchema, body)) {
    throw new Error('Worker enrollment response does not match the API contract')
  }
  return body
}

async function requestWorkerCredentialRotation(
  configuration: WorkerConfiguration,
  rotationToken: string,
  identity: StoredWorkerIdentity,
  publicKeyPem: string,
): Promise<RotateWorkerCredentialResponse> {
  const request: RotateWorkerCredentialRequest = {
    workerId: identity.workerId,
    currentCredentialId: identity.credentialId,
    publicKeyPem,
  }
  const endpoint = new URL(
    `/api/${BROWSHARE_API_VERSION}/workers/credential-rotation`,
    configuration.backendUrl,
  )
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${rotationToken}`,
        'content-type': 'application/json',
        'user-agent': `BrowShare-Worker/${BROWSHARE_VERSION}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(configuration.credentialRotationTimeoutMilliseconds),
    })
  } catch (cause) {
    throw new Error(`Worker credential rotation request failed for ${endpoint.origin}`, { cause })
  }
  const bodyText = await response.text()
  if (bodyText.length > 131_072) {
    throw new Error('Worker credential rotation response exceeds 128 KiB')
  }
  let body: unknown
  try {
    body = JSON.parse(bodyText) as unknown
  } catch (cause) {
    throw new Error(`Worker credential rotation returned non-JSON HTTP ${response.status}`, {
      cause,
    })
  }
  if (!response.ok) {
    if (Value.Check(ApiErrorEnvelopeSchema, body)) {
      throw new Error(
        `Worker credential rotation rejected: ${body.error.code}: ${body.error.message}`,
      )
    }
    throw new Error(`Worker credential rotation rejected with HTTP ${response.status}`)
  }
  if (!Value.Check(RotateWorkerCredentialResponseSchema, body)) {
    throw new Error('Worker credential rotation response does not match the API contract')
  }
  return body
}

function generateWorkerKeyPair(): {
  readonly privateKeyPem: string
  readonly publicKeyPem: string
} {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  })
  return {
    privateKeyPem: ensureTrailingNewline(privateKey),
    publicKeyPem: ensureTrailingNewline(publicKey),
  }
}

function validateWorkerIdentity(identity: StoredWorkerIdentity): void {
  if (!isPublicId(identity.workerId) || !isPublicId(identity.credentialId)) {
    throw new Error('Worker identity IDs must be UUIDv7 values')
  }
  let certificate: X509Certificate
  let caCertificate: X509Certificate
  let privateKey
  try {
    certificate = new X509Certificate(identity.certificatePem)
    caCertificate = new X509Certificate(identity.caCertificatePem)
    privateKey = createPrivateKey(identity.privateKeyPem)
  } catch (cause) {
    throw new Error('Worker identity contains invalid certificate or private key PEM', { cause })
  }
  if (!caCertificate.ca || !certificate.verify(caCertificate.publicKey)) {
    throw new Error('Worker certificate is not signed by the stored Worker CA')
  }
  if (!certificate.checkPrivateKey(privateKey)) {
    throw new Error('Worker certificate does not match the stored private key')
  }
  if (certificate.serialNumber !== identity.certificateSerial) {
    throw new Error('Worker certificate serial does not match identity metadata')
  }
  if (certificate.fingerprint256 !== identity.certificateFingerprintSha256) {
    throw new Error('Worker certificate fingerprint does not match identity metadata')
  }
  const expectedSan = `URI:urn:browshare:worker:${identity.workerId}`
  if (certificate.subjectAltName !== expectedSan) {
    throw new Error('Worker certificate does not contain the expected Worker URI identity')
  }
  const validFrom = new Date(certificate.validFrom).toISOString()
  const validTo = new Date(certificate.validTo).toISOString()
  if (validFrom !== identity.certificateNotBefore || validTo !== identity.certificateExpiresAt) {
    throw new Error('Worker certificate validity does not match identity metadata')
  }
  const now = Date.now()
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) {
    throw new Error('Worker certificate is not currently valid')
  }
  const controlUrl = new URL(identity.controlUrl)
  if (controlUrl.protocol !== 'wss:') {
    throw new Error('Worker identity control URL must use wss://')
  }
}

async function prepareIdentityDirectory(identityDirectory: string): Promise<void> {
  await mkdir(identityDirectory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await chmod(identityDirectory, 0o700)
}

async function persistWorkerIdentity(
  identityDirectory: string,
  identity: StoredWorkerIdentity,
): Promise<void> {
  const identityPath = join(identityDirectory, IDENTITY_FILE_NAME)
  const temporaryPath = join(
    identityDirectory,
    `.${IDENTITY_FILE_NAME}.${process.pid}.${Date.now().toString(36)}.tmp`,
  )
  await writeFile(temporaryPath, `${JSON.stringify(identity, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })
  try {
    await link(temporaryPath, identityPath)
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}

async function replaceWorkerIdentity(
  identityDirectory: string,
  identity: StoredWorkerIdentity,
): Promise<void> {
  const identityPath = join(identityDirectory, IDENTITY_FILE_NAME)
  const temporaryPath = join(
    identityDirectory,
    `.${IDENTITY_FILE_NAME}.${process.pid}.${Date.now().toString(36)}.rotation.tmp`,
  )
  await writeFile(temporaryPath, `${JSON.stringify(identity, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })
  try {
    await rename(temporaryPath, identityPath)
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}

function ensureTrailingNewline(value: string): string {
  return `${value.trimEnd()}\n`
}

function digestRotationToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hasErrorCode(cause: unknown, code: string): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { readonly code?: unknown }).code === code
  )
}
