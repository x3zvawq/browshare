import { resolve } from 'node:path'
import type { WorkerDownloadListenerConfiguration } from './download-server.js'

import {
  boolean,
  integer,
  optionalSecret,
  optionalText,
  requiredText,
  type Environment,
} from '@browshare/config'

export interface RemoteTabRuntimeConfiguration {
  readonly extensionHost: '127.0.0.1' | '::1'
  readonly extensionPort: number
  readonly extensionId: string
  readonly extensionVersion: string
  readonly extensionCrxSha256: string
  readonly extensionReleaseDirectory: string
  readonly extensionUpdatePort: number
  readonly managedPolicyPath: string
  readonly runtimeSecret: string
  readonly runtimeGeneration: string
  readonly requestTimeoutMilliseconds: number
}

export interface WorkerStorageThresholds {
  readonly lowBytes: number
  readonly lowPercent: number
  readonly criticalBytes: number
  readonly criticalPercent: number
}

export interface WorkerConfiguration {
  readonly name: string
  readonly healthHost: string
  readonly healthPort: number
  readonly logLevel: string
  readonly backendUrl: string
  readonly identityDirectory: string
  readonly enrollmentToken?: string
  readonly enrollmentTimeoutMilliseconds: number
  readonly credentialRotationToken?: string
  readonly credentialRotationTimeoutMilliseconds: number
  readonly controlServerCaCertificatePem?: string
  readonly controlHandshakeTimeoutMilliseconds: number
  readonly controlReconnectMinimumMilliseconds: number
  readonly controlReconnectMaximumMilliseconds: number
  readonly heartbeatAcknowledgementTimeoutMilliseconds: number
  readonly chromeExecutable: string
  readonly expectedChromeVersion: string
  readonly expectedRemoteTabCoreVersion: string
  readonly expectedExtensionVersion: string
  readonly profileStorageDirectory: string
  readonly temporaryStorageDirectory: string
  readonly storageThresholds: WorkerStorageThresholds
  readonly remoteTabRuntime?: RemoteTabRuntimeConfiguration
  readonly downloads?: WorkerDownloadListenerConfiguration
}

export function loadWorkerConfiguration(
  environment: Environment = process.env,
): WorkerConfiguration {
  const backendUrl = requiredText(environment, 'BROWSHARE_BACKEND_URL', {
    minLength: 1,
    maxLength: 2_048,
  })
  assertBackendUrl(backendUrl)
  const enrollmentToken = optionalSecret(environment, 'BROWSHARE_WORKER_ENROLLMENT_TOKEN', {
    minLength: 40,
    maxLength: 128,
  })
  const credentialRotationToken = optionalSecret(
    environment,
    'BROWSHARE_WORKER_CREDENTIAL_ROTATION_TOKEN',
    { minLength: 40, maxLength: 128 },
  )
  const controlServerCaCertificatePem = optionalSecret(
    environment,
    'BROWSHARE_WORKER_CONTROL_SERVER_CA_CERTIFICATE',
    { minLength: 256, maxLength: 65_536 },
  )
  const controlReconnectMinimumMilliseconds = integer(
    environment,
    'BROWSHARE_WORKER_CONTROL_RECONNECT_MIN_MS',
    { defaultValue: 1_000, minimum: 100, maximum: 60_000 },
  )
  const controlReconnectMaximumMilliseconds = integer(
    environment,
    'BROWSHARE_WORKER_CONTROL_RECONNECT_MAX_MS',
    { defaultValue: 30_000, minimum: 1_000, maximum: 300_000 },
  )
  if (controlReconnectMaximumMilliseconds < controlReconnectMinimumMilliseconds) {
    throw new RangeError(
      'BROWSHARE_WORKER_CONTROL_RECONNECT_MAX_MS must be greater than or equal to BROWSHARE_WORKER_CONTROL_RECONNECT_MIN_MS',
    )
  }
  const expectedExtensionVersion =
    optionalText(environment, 'BROWSHARE_EXPECTED_EXTENSION_VERSION', {
      defaultValue: '0.1.25',
      minLength: 1,
      maxLength: 64,
    }) ?? '0.1.25'
  if (!/^\d+(?:\.\d+){0,3}$/u.test(expectedExtensionVersion)) {
    throw new TypeError('BROWSHARE_EXPECTED_EXTENSION_VERSION must be a Chrome Extension version')
  }
  const remoteTabRuntime = loadRemoteTabRuntimeConfiguration(environment, expectedExtensionVersion)

  const downloadEndpoint = optionalText(environment, 'BROWSHARE_WORKER_DOWNLOAD_ENDPOINT', {
    maxLength: 2048,
  })
  let downloads: WorkerDownloadListenerConfiguration | undefined
  if (downloadEndpoint !== undefined) {
    if (!remoteTabRuntime)
      throw new TypeError('Worker download listener requires Remote Tab runtime')
    const endpoint = new URL(downloadEndpoint)
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new TypeError(
        'BROWSHARE_WORKER_DOWNLOAD_ENDPOINT must be an HTTPS URL without credentials, query or fragment',
      )
    const portalOrigin = requiredText(environment, 'BROWSHARE_WORKER_DOWNLOAD_PORTAL_ORIGIN', {
      maxLength: 2048,
    })
    const portal = new URL(portalOrigin)
    if (
      portal.protocol !== 'https:' ||
      portal.origin !== portalOrigin ||
      portal.username ||
      portal.password
    )
      throw new TypeError('BROWSHARE_WORKER_DOWNLOAD_PORTAL_ORIGIN must be an HTTPS origin')
    downloads = {
      endpoint: endpoint.href,
      portalOrigin,
      host:
        optionalText(environment, 'BROWSHARE_WORKER_DOWNLOAD_HOST', {
          defaultValue: '127.0.0.1',
          maxLength: 255,
        }) ?? '127.0.0.1',
      port: integer(environment, 'BROWSHARE_WORKER_DOWNLOAD_PORT', {
        defaultValue: 3411,
        minimum: 0,
        maximum: 65535,
      }),
    }
  }

  const storageThresholds: WorkerStorageThresholds = {
    lowBytes: integer(environment, 'BROWSHARE_WORKER_LOW_DISK_BYTES', {
      defaultValue: 5 * 1024 ** 3,
      minimum: 0,
    }),
    lowPercent: integer(environment, 'BROWSHARE_WORKER_LOW_DISK_PERCENT', {
      defaultValue: 10,
      minimum: 0,
      maximum: 100,
    }),
    criticalBytes: integer(environment, 'BROWSHARE_WORKER_CRITICAL_DISK_BYTES', {
      defaultValue: 1024 ** 3,
      minimum: 0,
    }),
    criticalPercent: integer(environment, 'BROWSHARE_WORKER_CRITICAL_DISK_PERCENT', {
      defaultValue: 3,
      minimum: 0,
      maximum: 100,
    }),
  }
  if (
    storageThresholds.criticalBytes > storageThresholds.lowBytes ||
    storageThresholds.criticalPercent > storageThresholds.lowPercent
  )
    throw new RangeError('Critical disk thresholds must not exceed low disk thresholds')

  return {
    storageThresholds,
    ...(downloads === undefined ? {} : { downloads }),
    name: requiredText(environment, 'BROWSHARE_WORKER_NAME', {
      minLength: 1,
      maxLength: 128,
    }),
    healthHost:
      optionalText(environment, 'BROWSHARE_WORKER_HEALTH_HOST', {
        defaultValue: '127.0.0.1',
        maxLength: 255,
      }) ?? '127.0.0.1',
    healthPort: integer(environment, 'BROWSHARE_WORKER_HEALTH_PORT', {
      defaultValue: 3410,
      minimum: 0,
      maximum: 65_535,
    }),
    logLevel:
      optionalText(environment, 'BROWSHARE_WORKER_LOG_LEVEL', {
        defaultValue: 'info',
        maxLength: 32,
      }) ?? 'info',
    backendUrl,
    identityDirectory: resolve(
      optionalText(environment, 'BROWSHARE_WORKER_IDENTITY_DIRECTORY', {
        defaultValue: './data/worker-identity',
        maxLength: 4_096,
      }) ?? './data/worker-identity',
    ),
    ...(enrollmentToken === undefined ? {} : { enrollmentToken }),
    enrollmentTimeoutMilliseconds: integer(environment, 'BROWSHARE_WORKER_ENROLLMENT_TIMEOUT_MS', {
      defaultValue: 15_000,
      minimum: 1_000,
      maximum: 120_000,
    }),
    ...(credentialRotationToken === undefined ? {} : { credentialRotationToken }),
    credentialRotationTimeoutMilliseconds: integer(
      environment,
      'BROWSHARE_WORKER_CREDENTIAL_ROTATION_TIMEOUT_MS',
      { defaultValue: 15_000, minimum: 1_000, maximum: 120_000 },
    ),
    ...(controlServerCaCertificatePem === undefined ? {} : { controlServerCaCertificatePem }),
    controlHandshakeTimeoutMilliseconds: integer(
      environment,
      'BROWSHARE_WORKER_CONTROL_HANDSHAKE_TIMEOUT_MS',
      { defaultValue: 10_000, minimum: 1_000, maximum: 120_000 },
    ),
    controlReconnectMinimumMilliseconds,
    controlReconnectMaximumMilliseconds,
    heartbeatAcknowledgementTimeoutMilliseconds: integer(
      environment,
      'BROWSHARE_WORKER_HEARTBEAT_ACK_TIMEOUT_MS',
      { defaultValue: 30_000, minimum: 3_000, maximum: 300_000 },
    ),
    chromeExecutable:
      optionalText(environment, 'BROWSHARE_WORKER_CHROME_EXECUTABLE', {
        defaultValue: '/usr/bin/google-chrome-stable',
        maxLength: 4_096,
      }) ?? '/usr/bin/google-chrome-stable',
    expectedChromeVersion:
      optionalText(environment, 'BROWSHARE_EXPECTED_CHROME_VERSION', {
        defaultValue: '152.0.7977.75',
        minLength: 1,
        maxLength: 64,
      }) ?? '152.0.7977.75',
    expectedRemoteTabCoreVersion:
      optionalText(environment, 'BROWSHARE_EXPECTED_REMOTE_TAB_CORE_VERSION', {
        defaultValue: '0.1.25',
        minLength: 1,
        maxLength: 64,
      }) ?? '0.1.25',
    expectedExtensionVersion,
    profileStorageDirectory: resolve(
      optionalText(environment, 'BROWSHARE_WORKER_PROFILE_STORAGE_DIRECTORY', {
        defaultValue: './data/profiles',
        maxLength: 4_096,
      }) ?? './data/profiles',
    ),
    temporaryStorageDirectory: resolve(
      optionalText(environment, 'BROWSHARE_WORKER_TEMPORARY_STORAGE_DIRECTORY', {
        defaultValue: './data/session-temp',
        maxLength: 4_096,
      }) ?? './data/session-temp',
    ),
    ...(remoteTabRuntime === undefined ? {} : { remoteTabRuntime }),
  }
}

function loadRemoteTabRuntimeConfiguration(
  environment: Environment,
  expectedExtensionVersion: string,
): RemoteTabRuntimeConfiguration | undefined {
  if (!boolean(environment, 'BROWSHARE_REMOTE_TAB_ENABLED', false)) return undefined

  const extensionHost =
    optionalText(environment, 'BROWSHARE_REMOTE_TAB_EXTENSION_HOST', {
      defaultValue: '127.0.0.1',
      maxLength: 16,
    }) ?? '127.0.0.1'
  if (extensionHost !== '127.0.0.1' && extensionHost !== '::1') {
    throw new TypeError('BROWSHARE_REMOTE_TAB_EXTENSION_HOST must be a loopback address')
  }
  const extensionId = requiredText(environment, 'BROWSHARE_REMOTE_TAB_EXTENSION_ID', {
    minLength: 32,
    maxLength: 32,
  })
  if (!/^[a-p]{32}$/u.test(extensionId)) {
    throw new TypeError('BROWSHARE_REMOTE_TAB_EXTENSION_ID must be a Chrome extension ID')
  }
  const extensionCrxSha256 = requiredText(
    environment,
    'BROWSHARE_REMOTE_TAB_EXTENSION_CRX_SHA256',
    { minLength: 64, maxLength: 64 },
  )
  if (!/^[0-9a-f]{64}$/u.test(extensionCrxSha256)) {
    throw new TypeError('BROWSHARE_REMOTE_TAB_EXTENSION_CRX_SHA256 must be lowercase SHA-256')
  }
  const runtimeSecret = optionalSecret(environment, 'BROWSHARE_REMOTE_TAB_RUNTIME_SECRET', {
    minLength: 32,
    maxLength: 16_384,
  })
  if (runtimeSecret === undefined) {
    throw new TypeError(
      'Missing required secret BROWSHARE_REMOTE_TAB_RUNTIME_SECRET or BROWSHARE_REMOTE_TAB_RUNTIME_SECRET_FILE',
    )
  }

  return {
    extensionHost,
    extensionPort: integer(environment, 'BROWSHARE_REMOTE_TAB_EXTENSION_PORT', {
      defaultValue: 9224,
      minimum: 0,
      maximum: 65_535,
    }),
    extensionId,
    extensionVersion: expectedExtensionVersion,
    extensionCrxSha256,
    extensionReleaseDirectory: resolve(
      optionalText(environment, 'BROWSHARE_REMOTE_TAB_EXTENSION_RELEASE_DIRECTORY', {
        defaultValue: '/opt/browshare/extension-release',
        maxLength: 4_096,
      }) ?? '/opt/browshare/extension-release',
    ),
    extensionUpdatePort: integer(environment, 'BROWSHARE_REMOTE_TAB_EXTENSION_UPDATE_PORT', {
      defaultValue: 9225,
      minimum: 0,
      maximum: 65_535,
    }),
    managedPolicyPath: resolve(
      optionalText(environment, 'BROWSHARE_REMOTE_TAB_MANAGED_POLICY_PATH', {
        defaultValue: '/var/lib/browshare/chrome-policy/browshare-remote-tab.json',
        maxLength: 4_096,
      }) ?? '/var/lib/browshare/chrome-policy/browshare-remote-tab.json',
    ),
    runtimeSecret,
    runtimeGeneration: requiredText(environment, 'BROWSHARE_REMOTE_TAB_RUNTIME_GENERATION', {
      minLength: 1,
      maxLength: 256,
    }),
    requestTimeoutMilliseconds: integer(environment, 'BROWSHARE_REMOTE_TAB_EXTENSION_TIMEOUT_MS', {
      defaultValue: 15_000,
      minimum: 100,
      maximum: 300_000,
    }),
  }
}

function assertBackendUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch (cause) {
    throw new TypeError(`Invalid Backend URL: ${value}`, { cause })
  }
  const loopbackHttp =
    url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !loopbackHttp) ||
    url.origin !== value ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new TypeError(
      'BROWSHARE_BACKEND_URL must be an HTTPS origin; HTTP is allowed only for loopback development',
    )
  }
}
