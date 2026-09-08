import {
  boolean,
  integer,
  optionalText,
  optionalSecret,
  requiredText,
  secret,
  stringList,
  type Environment,
} from '@browshare/config'
import { loadDatabaseConfiguration } from '@browshare/database'
import { loadGatewayConfiguration, type GatewayConfiguration } from './gateway-configuration.js'

export interface BootstrapAdminConfiguration {
  readonly email: string
  readonly displayName: string
  readonly password: string
}

export interface BackendConfiguration {
  readonly host: string
  readonly port: number
  readonly databaseUrl: string
  readonly allowedOrigins: readonly string[]
  readonly sessionSecret: string
  readonly cookieSecure: boolean
  readonly logLevel: string
  readonly docsEnabled: boolean
  readonly gateways: readonly GatewayConfiguration[]
  readonly workerControlUrl: string
  readonly workerControlListener: {
    readonly host: string
    readonly port: number
    readonly tlsCertificatePem: string
    readonly tlsPrivateKeyPem: string
    readonly helloTimeoutMilliseconds: number
    readonly heartbeatIntervalMilliseconds: number
    readonly offlineAfterMilliseconds: number
    readonly commandAcknowledgementTimeoutMilliseconds: number
    readonly commandResultTimeoutMilliseconds: number
    readonly profileRuntimeCommandTimeoutMilliseconds: number
    readonly commandMaximumAttempts: number
  }
  readonly workerCertificateAuthority: {
    readonly certificatePem: string
    readonly privateKeyPem: string
    readonly certificateValidityDays: number
  }
  readonly bootstrapAdmin?: BootstrapAdminConfiguration
  readonly bootstrapToken?: string
}

export function loadBackendConfiguration(
  environment: Environment = process.env,
): BackendConfiguration {
  const allowedOrigins = stringList(environment, 'BROWSHARE_BACKEND_ALLOWED_ORIGINS', [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ])
  for (const origin of allowedOrigins) assertHttpOrigin(origin)
  const bootstrapAdmin = loadBootstrapAdminConfiguration(environment)
  const bootstrapToken = optionalSecret(environment, 'BOOTSTRAP_TOKEN', {
    minLength: 32,
    maxLength: 1024,
  })
  const workerControlUrl = requiredText(environment, 'BROWSHARE_WORKER_CONTROL_URL', {
    minLength: 1,
    maxLength: 2_048,
  })
  assertWorkerControlUrl(workerControlUrl)
  const workerHeartbeatIntervalMilliseconds = integer(
    environment,
    'BROWSHARE_WORKER_HEARTBEAT_INTERVAL_MS',
    {
      defaultValue: 10_000,
      minimum: 1_000,
      maximum: 300_000,
    },
  )
  const workerOfflineAfterMilliseconds = integer(environment, 'BROWSHARE_WORKER_OFFLINE_AFTER_MS', {
    defaultValue: 30_000,
    minimum: 3_000,
    maximum: 900_000,
  })
  if (workerOfflineAfterMilliseconds < workerHeartbeatIntervalMilliseconds * 2) {
    throw new TypeError(
      'BROWSHARE_WORKER_OFFLINE_AFTER_MS must be at least twice BROWSHARE_WORKER_HEARTBEAT_INTERVAL_MS',
    )
  }

  return {
    host:
      optionalText(environment, 'BROWSHARE_BACKEND_HOST', {
        defaultValue: '127.0.0.1',
        maxLength: 255,
      }) ?? '127.0.0.1',
    port: integer(environment, 'BROWSHARE_BACKEND_PORT', {
      defaultValue: 3400,
      minimum: 0,
      maximum: 65_535,
    }),
    databaseUrl: loadDatabaseConfiguration(environment).url,
    allowedOrigins,
    sessionSecret: secret(environment, 'BROWSHARE_SESSION_SECRET', {
      minLength: 32,
      maxLength: 16_384,
    }),
    cookieSecure: boolean(environment, 'BROWSHARE_COOKIE_SECURE', true),
    logLevel:
      optionalText(environment, 'BROWSHARE_BACKEND_LOG_LEVEL', {
        defaultValue: 'info',
        maxLength: 32,
      }) ?? 'info',
    docsEnabled: boolean(environment, 'BROWSHARE_BACKEND_DOCS_ENABLED', false),
    gateways: loadGatewayConfiguration(environment),
    workerControlUrl,
    workerControlListener: {
      host:
        optionalText(environment, 'BROWSHARE_WORKER_CONTROL_HOST', {
          defaultValue: '127.0.0.1',
          maxLength: 255,
        }) ?? '127.0.0.1',
      port: integer(environment, 'BROWSHARE_WORKER_CONTROL_PORT', {
        defaultValue: 3443,
        minimum: 0,
        maximum: 65_535,
      }),
      tlsCertificatePem: secret(environment, 'BROWSHARE_WORKER_CONTROL_TLS_CERTIFICATE', {
        minLength: 256,
        maxLength: 65_536,
      }),
      tlsPrivateKeyPem: secret(environment, 'BROWSHARE_WORKER_CONTROL_TLS_PRIVATE_KEY', {
        minLength: 160,
        maxLength: 65_536,
      }),
      helloTimeoutMilliseconds: integer(environment, 'BROWSHARE_WORKER_HELLO_TIMEOUT_MS', {
        defaultValue: 10_000,
        minimum: 1_000,
        maximum: 120_000,
      }),
      heartbeatIntervalMilliseconds: workerHeartbeatIntervalMilliseconds,
      offlineAfterMilliseconds: workerOfflineAfterMilliseconds,
      commandAcknowledgementTimeoutMilliseconds: integer(
        environment,
        'BROWSHARE_WORKER_COMMAND_ACK_TIMEOUT_MS',
        { defaultValue: 3_000, minimum: 250, maximum: 60_000 },
      ),
      profileRuntimeCommandTimeoutMilliseconds: integer(
        environment,
        'BROWSHARE_PROFILE_RUNTIME_COMMAND_TIMEOUT_MS',
        {
          defaultValue: 120_000,
          minimum: 1_000,
          maximum: 300_000,
        },
      ),
      commandResultTimeoutMilliseconds: integer(
        environment,
        'BROWSHARE_WORKER_COMMAND_RESULT_TIMEOUT_MS',
        { defaultValue: 60_000, minimum: 1_000, maximum: 600_000 },
      ),
      commandMaximumAttempts: integer(environment, 'BROWSHARE_WORKER_COMMAND_MAX_ATTEMPTS', {
        defaultValue: 3,
        minimum: 1,
        maximum: 10,
      }),
    },
    workerCertificateAuthority: {
      certificatePem: secret(environment, 'BROWSHARE_WORKER_CA_CERTIFICATE', {
        minLength: 256,
        maxLength: 65_536,
      }),
      privateKeyPem: secret(environment, 'BROWSHARE_WORKER_CA_PRIVATE_KEY', {
        minLength: 160,
        maxLength: 65_536,
      }),
      certificateValidityDays: integer(environment, 'BROWSHARE_WORKER_CERTIFICATE_VALIDITY_DAYS', {
        defaultValue: 90,
        minimum: 1,
        maximum: 825,
      }),
    },
    ...(bootstrapAdmin === undefined ? {} : { bootstrapAdmin }),
    ...(bootstrapToken === undefined ? {} : { bootstrapToken }),
  }
}

function loadBootstrapAdminConfiguration(
  environment: Environment,
): BootstrapAdminConfiguration | undefined {
  const email = optionalText(environment, 'BOOTSTRAP_ADMIN_EMAIL', { maxLength: 320 })
  const passwordConfigured =
    environment.BOOTSTRAP_ADMIN_PASSWORD !== undefined ||
    environment.BOOTSTRAP_ADMIN_PASSWORD_FILE !== undefined

  if (email === undefined && !passwordConfigured) return undefined
  if (email === undefined) {
    throw new TypeError('BOOTSTRAP_ADMIN_EMAIL is required when a bootstrap password is set')
  }
  if (!passwordConfigured) {
    throw new TypeError(
      'BOOTSTRAP_ADMIN_PASSWORD or BOOTSTRAP_ADMIN_PASSWORD_FILE is required with BOOTSTRAP_ADMIN_EMAIL',
    )
  }

  const normalizedEmail = normalizeEmail(email)
  const displayName =
    optionalText(environment, 'BOOTSTRAP_ADMIN_DISPLAY_NAME', {
      maxLength: 128,
    }) ?? normalizedEmail.slice(0, normalizedEmail.indexOf('@'))

  return {
    email: normalizedEmail,
    displayName,
    password: secret(environment, 'BOOTSTRAP_ADMIN_PASSWORD', {
      minLength: 10,
      maxLength: 1024,
    }),
  }
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase()
  const separator = email.indexOf('@')
  if (
    separator < 1 ||
    separator !== email.lastIndexOf('@') ||
    separator === email.length - 1 ||
    email.length > 320
  ) {
    throw new TypeError('BOOTSTRAP_ADMIN_EMAIL must be a valid email address')
  }
  return email
}

function assertHttpOrigin(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch (cause) {
    throw new TypeError(`Invalid Backend allowed origin: ${value}`, { cause })
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== value ||
    url.username ||
    url.password
  ) {
    throw new TypeError(`Backend allowed origin must be an exact HTTP(S) origin: ${value}`)
  }
}

function assertWorkerControlUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch (cause) {
    throw new TypeError(`Invalid Worker control URL: ${value}`, { cause })
  }
  if (
    url.protocol !== 'wss:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new TypeError('BROWSHARE_WORKER_CONTROL_URL must be an absolute wss:// URL')
  }
}
