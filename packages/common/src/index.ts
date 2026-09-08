import { Buffer } from 'node:buffer'
import pino, { type Logger, type LoggerOptions } from 'pino'
import { validate as validateUuid, v7 as uuidv7, version as uuidVersion } from 'uuid'

export const SENSITIVE_LOG_PATHS = [
  'authorization',
  'cookie',
  'password',
  'passwordHash',
  'privateKey',
  'privateKeyPem',
  'proxy.password',
  'request.headers.authorization',
  'request.headers.cookie',
  'response.headers.set-cookie',
  'secret',
  'token',
  'tlsPrivateKeyPem',
  'workerControlListener.tlsPrivateKeyPem',
  'workerCertificateAuthority.privateKeyPem',
] as const

export function createServiceLogger(options: {
  service: string
  level?: string
  base?: Readonly<Record<string, unknown>>
}): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level ?? 'info',
    base: { service: options.service, ...options.base },
    redact: { paths: [...SENSITIVE_LOG_PATHS], censor: '[Redacted]' },
    serializers: {
      req: serializeRequest,
      err: safeErrorDiagnostic,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  }
  return pino(loggerOptions)
}

/** Error messages, stacks and nested causes may contain credentials or source data. */
export function safeErrorDiagnostic(error: unknown): Readonly<Record<string, unknown>> {
  const diagnostic: Record<string, unknown> = {
    name: error instanceof Error ? error.name : typeof error,
  }
  let current = error
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) break
    const record = current as Readonly<Record<string, unknown>>
    for (const key of ['code', 'constraint_name', 'schema_name', 'table_name', 'routine']) {
      const value = record[key]
      if (typeof value === 'string') diagnostic[key] = value
    }
    if (!('cause' in record)) break
    current = record.cause
  }
  return diagnostic
}

function serializeRequest(request: unknown): Readonly<Record<string, unknown>> {
  if (typeof request !== 'object' || request === null) return {}
  const record = request as Readonly<Record<string, unknown>>
  const socket = asRecord(record.socket)
  // Fastify resolves the route before its incoming-request log. Raw paths and
  // Host headers are user input and can contain credentials, even on a 404.
  const route = asRecord(record.routeOptions)
  const url = typeof route.url === 'string' ? route.url : '[unmatched]'
  return {
    ...(typeof record.method === 'string' ? { method: record.method } : {}),
    url,
    ...(typeof record.remoteAddress === 'string'
      ? { remoteAddress: record.remoteAddress }
      : typeof socket.remoteAddress === 'string'
        ? { remoteAddress: socket.remoteAddress }
        : {}),
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : {}
}

export function createPublicId(): string {
  return uuidv7()
}

export function isPublicId(value: string): boolean {
  return validateUuid(value) && uuidVersion(value) === 7
}

export function utcNow(): string {
  return new Date().toISOString()
}

export function toUtcIso(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new TypeError('Value is not a valid date')
  return date.toISOString()
}

export interface PageCursor {
  readonly id: string
  readonly createdAt: string
}

export function encodePageCursor(cursor: PageCursor): string {
  if (!isPublicId(cursor.id)) throw new TypeError('Cursor ID must be a UUIDv7')
  const normalized = { version: 1, id: cursor.id, createdAt: toUtcIso(cursor.createdAt) }
  return Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url')
}

export function decodePageCursor(value: string): PageCursor {
  try {
    if (value.length === 0 || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value))
      throw new TypeError('Cursor encoding is invalid')
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('id' in parsed) ||
      typeof parsed.id !== 'string' ||
      !isPublicId(parsed.id) ||
      !('createdAt' in parsed) ||
      typeof parsed.createdAt !== 'string'
    ) {
      throw new TypeError('Cursor payload is invalid')
    }
    return { id: parsed.id, createdAt: toUtcIso(parsed.createdAt) }
  } catch (cause) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: 'The page cursor is invalid.',
      cause,
    })
  }
}

export function normalizePageLimit(
  value: number | undefined,
  options: { defaultValue?: number; maximum?: number } = {},
): number {
  const defaultValue = options.defaultValue ?? 50
  const maximum = options.maximum ?? 200
  const limit = value ?? defaultValue
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: `Page limit must be between 1 and ${maximum}.`,
    })
  }
  return limit
}

export class BrowShareError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly details?: unknown

  constructor(options: {
    code: string
    message: string
    statusCode: number
    details?: unknown
    cause?: unknown
  }) {
    super(options.message, { cause: options.cause })
    this.name = 'BrowShareError'
    this.code = options.code
    this.statusCode = options.statusCode
    if (options.details !== undefined) this.details = options.details
  }
}

export { normalizeProxyHost, assertProxyCredentials } from './proxy.js'
