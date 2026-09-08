import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { arch, cpus, freemem, hostname, loadavg, platform, totalmem, type CpuInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'

import { createPublicId } from '@browshare/common'
import {
  BROWSHARE_VERSION,
  WORKER_CONTROL_PROTOCOL_MAJOR,
  WORKER_CONTROL_PROTOCOL_MINOR,
  type WorkerCapabilityReport,
  type WorkerProbeCheck,
  type WorkerProbeCheckName,
  type WorkerRuntimeMetrics,
  type WorkerRuntimeSnapshot,
  type WorkerSnapshotAcceptedMessage,
  type WorkerStorageSnapshot,
  type WorkerStorageFact,
  type ProfileStorageUsage,
  type StoragePolicy,
  type ProfileStoragePolicy,
} from '@browshare/contracts'

import type { WorkerConfiguration } from './configuration.js'
import { StorageProtection } from './storage-protection.js'
import { readStorageSnapshot } from './storage-observation.js'

const execFileAsync = promisify(execFile)
const REMOTE_TAB_RUNTIME_CHECKS = [
  'CHROME_SANDBOX',
  'CDP_LOOPBACK',
  'EXTENSION_POLICY',
  'TAB_CAPTURE',
  'EXTENSION_LOOPBACK',
  'WEBRTC',
  'PROXY_ADAPTER',
] as const satisfies readonly WorkerProbeCheckName[]

interface CpuTimesSnapshot {
  readonly idle: number
  readonly total: number
}

export interface RemoteTabRuntimeProbeSnapshot {
  readonly checks: readonly WorkerProbeCheck[]
  readonly chromeVersion: string | null
  readonly remoteTabCoreVersion: string | null
  readonly extensionVersion: string | null
  readonly supportedCapabilities: readonly string[]
}

export interface RemoteTabRuntimeMetricsSnapshot {
  readonly chromeInstances: number
  readonly tabs: number
  readonly activeSessions: number
}

export interface RemoteTabRuntimeObserver {
  readStorageFacts?(): { storage: WorkerStorageFact; profileStorageUsage: ProfileStorageUsage[] }
  applyStoragePolicy?(
    workerPolicy: StoragePolicy,
    profilePolicy?: ProfileStoragePolicy,
  ): Promise<void>
  readonly storageProtection?: StorageProtection
  probe(): Promise<RemoteTabRuntimeProbeSnapshot>
  readMetrics(): Promise<RemoteTabRuntimeMetricsSnapshot>
  readRuntimeFacts(): Promise<
    Pick<WorkerRuntimeSnapshot, 'profiles' | 'sessions' | 'closedSessions'>
  >
  applyReconciliationPlan(
    plan: Pick<
      WorkerSnapshotAcceptedMessage['payload'],
      'closeSessions' | 'stopProfiles' | 'leases' | 'closedSessionIds'
    >,
    recoverable?: boolean,
  ): Promise<void>
}

type RuntimeMonitorConfiguration = Pick<
  WorkerConfiguration,
  | 'chromeExecutable'
  | 'expectedChromeVersion'
  | 'expectedRemoteTabCoreVersion'
  | 'expectedExtensionVersion'
  | 'identityDirectory'
  | 'profileStorageDirectory'
  | 'temporaryStorageDirectory'
  | 'storageThresholds'
>

export class WorkerRuntimeMonitor {
  readonly #configuration: RuntimeMonitorConfiguration
  readonly #runtimeObserver: RemoteTabRuntimeObserver | undefined
  #capabilityReport: WorkerCapabilityReport | undefined
  #previousCpuTimes = readCpuTimes()
  readonly #localStorage: StorageProtection | undefined

  constructor(
    configuration: RuntimeMonitorConfiguration,
    runtimeObserver?: RemoteTabRuntimeObserver,
  ) {
    this.#configuration = configuration
    this.#runtimeObserver = runtimeObserver
    this.#localStorage = runtimeObserver?.readStorageFacts
      ? undefined
      : new StorageProtection(
          configuration.identityDirectory,
          configuration.profileStorageDirectory,
          configuration.temporaryStorageDirectory,
          configuration.storageThresholds,
        )
  }

  get capabilityReport(): WorkerCapabilityReport {
    if (this.#capabilityReport === undefined) {
      throw new Error('Worker runtime monitor has not been initialized')
    }
    return this.#capabilityReport
  }

  async initialize(): Promise<WorkerCapabilityReport> {
    if (this.#capabilityReport !== undefined) {
      throw new Error('Worker runtime monitor is already initialized')
    }

    await this.#localStorage?.initialize()
    return this.#collectCapabilityReport()
  }

  async refreshCapabilities(): Promise<WorkerCapabilityReport> {
    if (this.#capabilityReport === undefined) {
      throw new Error('Worker runtime monitor has not been initialized')
    }
    return this.#collectCapabilityReport()
  }

  async #collectCapabilityReport(): Promise<WorkerCapabilityReport> {
    const storageChecks = await Promise.all([
      inspectStorage('identity', this.#configuration.identityDirectory, 'IDENTITY_STORAGE'),
      inspectStorage('profiles', this.#configuration.profileStorageDirectory, 'PROFILE_STORAGE'),
      inspectStorage(
        'temporary',
        this.#configuration.temporaryStorageDirectory,
        'TEMPORARY_STORAGE',
      ),
    ])
    const chrome = await inspectChrome(
      this.#configuration.chromeExecutable,
      this.#configuration.expectedChromeVersion,
    )
    const installedCoreVersion = await resolveInstalledPackageVersion('@browshare/remote-tab-core')
    const platformCheck = hostPlatformCheck()

    let runtimeSnapshot: RemoteTabRuntimeProbeSnapshot
    if (this.#runtimeObserver === undefined) {
      runtimeSnapshot = {
        checks: REMOTE_TAB_RUNTIME_CHECKS.map((name) => ({
          name,
          status: 'NOT_RUN',
          code: 'REMOTE_TAB_RUNTIME_UNAVAILABLE',
          summary: 'The Remote Tab runtime is not attached to this Worker build.',
          guidance:
            'Install and configure the supported Remote Tab runtime before enabling this Worker.',
        })),
        chromeVersion: chrome.version,
        remoteTabCoreVersion: installedCoreVersion,
        extensionVersion: null,
        supportedCapabilities: [],
      }
    } else {
      runtimeSnapshot = await this.#runtimeObserver.probe()
    }

    const actualChromeVersion = runtimeSnapshot.chromeVersion ?? chrome.version
    const actualCoreVersion = runtimeSnapshot.remoteTabCoreVersion ?? installedCoreVersion
    const runtimeChecks = runtimeSnapshot.checks.filter(
      (check) => !['CHROME_VERSION', 'EXTENSION_VERSION', 'REMOTE_TAB_CORE'].includes(check.name),
    )

    const checks = [
      platformCheck,
      ...storageChecks.map((result) => result.check),
      chrome.binaryCheck,
      versionCheck(
        'CHROME_VERSION',
        actualChromeVersion,
        this.#configuration.expectedChromeVersion,
        'Install the Google Chrome Stable version pinned by the BrowShare compatibility manifest.',
      ),
      versionCheck(
        'REMOTE_TAB_CORE',
        actualCoreVersion,
        this.#configuration.expectedRemoteTabCoreVersion,
        'Install the exact supported @browshare/remote-tab-core package in the Worker image.',
      ),
      versionCheck(
        'EXTENSION_VERSION',
        runtimeSnapshot.extensionVersion,
        this.#configuration.expectedExtensionVersion,
        'Install the signed Extension version pinned by the BrowShare compatibility manifest.',
      ),
      ...runtimeChecks,
    ]
    const storage = storageChecks.map((result) => result.storage)
    const report: WorkerCapabilityReport = {
      status: checks.every((check) => check.status === 'PASS') ? 'READY' : 'FAILED',
      completedAt: new Date().toISOString(),
      host: {
        hostname: hostname(),
        platform: platform(),
        architecture: arch(),
        logicalCpuCount: Math.max(1, cpus().length),
        totalMemoryBytes: clampSafeInteger(totalmem()),
      },
      versions: {
        worker: BROWSHARE_VERSION,
        controlProtocol: `${WORKER_CONTROL_PROTOCOL_MAJOR}.${WORKER_CONTROL_PROTOCOL_MINOR}`,
        node: process.versions.node,
        chrome: actualChromeVersion,
        remoteTabCore: actualCoreVersion,
        extension: runtimeSnapshot.extensionVersion,
      },
      checks,
      supportedCapabilities: [...new Set(runtimeSnapshot.supportedCapabilities)].sort(),
      storage,
    }
    this.#capabilityReport = report
    return report
  }

  async collectMetrics(): Promise<WorkerRuntimeMetrics> {
    const currentCpuTimes = readCpuTimes()
    const elapsedTotal = currentCpuTimes.total - this.#previousCpuTimes.total
    const elapsedIdle = currentCpuTimes.idle - this.#previousCpuTimes.idle
    this.#previousCpuTimes = currentCpuTimes
    const utilizationPercent =
      elapsedTotal <= 0 ? 0 : clampPercentage(((elapsedTotal - elapsedIdle) / elapsedTotal) * 100)
    const storage = await Promise.all([
      readLegacyStorageSnapshot('identity', this.#configuration.identityDirectory),
      readLegacyStorageSnapshot('profiles', this.#configuration.profileStorageDirectory),
      readLegacyStorageSnapshot('temporary', this.#configuration.temporaryStorageDirectory),
    ])
    const [loadAverage1, loadAverage5, loadAverage15] = loadavg()
    const network = await readLinuxNetworkCounters()
    const runtime = (await this.#runtimeObserver?.readMetrics()) ?? {
      chromeInstances: 0,
      tabs: 0,
      activeSessions: 0,
    }

    return {
      cpu: {
        logicalCpuCount: Math.max(1, cpus().length),
        utilizationPercent,
        loadAverage1: finiteNonNegative(loadAverage1),
        loadAverage5: finiteNonNegative(loadAverage5),
        loadAverage15: finiteNonNegative(loadAverage15),
      },
      memory: {
        totalBytes: clampSafeInteger(totalmem()),
        availableBytes: clampSafeInteger(freemem()),
        workerRssBytes: clampSafeInteger(process.memoryUsage().rss),
      },
      storage,
      runtime,
      network,
    }
  }

  async collectRuntimeSnapshot(
    instanceId: string,
    sequence: number,
  ): Promise<WorkerRuntimeSnapshot> {
    const facts = (await this.#runtimeObserver?.readRuntimeFacts()) ?? {
      profiles: [],
      sessions: [],
    }
    return {
      ...this.collectStorageFacts(),
      instanceId,
      sequence,
      observedAt: new Date().toISOString(),
      profiles: [...facts.profiles].sort((left, right) =>
        left.profileId.localeCompare(right.profileId),
      ),
      sessions: [...facts.sessions].sort((left, right) =>
        left.sessionId.localeCompare(right.sessionId),
      ),
      closedSessions: [...(facts.closedSessions ?? [])].sort((left, right) =>
        left.sessionId.localeCompare(right.sessionId),
      ),
    }
  }

  collectStorageFacts(): {
    storage: WorkerStorageFact
    profileStorageUsage: ProfileStorageUsage[]
  } {
    return (
      this.#runtimeObserver?.readStorageFacts?.() ?? {
        storage: this.#localStorage!.snapshot(),
        profileStorageUsage: this.#localStorage!.profileUsages(),
      }
    )
  }

  async applyStoragePolicy(
    worker: StoragePolicy,
    profile?: ProfileStoragePolicy,
  ): Promise<{ storage: WorkerStorageFact; profileUsage: ProfileStorageUsage | null }> {
    const protection = this.#runtimeObserver?.storageProtection ?? this.#localStorage!
    await protection.applyPolicy(worker, profile)
    await protection.refresh()
    return {
      storage: protection.snapshot(),
      profileUsage: profile ? protection.profileUsage(profile.profileId) : null,
    }
  }

  async close(): Promise<void> {
    await this.#localStorage?.close()
  }

  async applyReconciliationPlan(
    plan: Pick<
      WorkerSnapshotAcceptedMessage['payload'],
      'closeSessions' | 'stopProfiles' | 'leases' | 'closedSessionIds'
    >,
    recoverable?: boolean,
  ): Promise<void> {
    if (
      plan.closeSessions.length === 0 &&
      plan.stopProfiles.length === 0 &&
      !plan.leases?.length &&
      !plan.closedSessionIds?.length
    )
      return
    if (this.#runtimeObserver === undefined) {
      throw new Error('Worker reconciliation requires an attached Remote Tab runtime')
    }
    await this.#runtimeObserver.applyReconciliationPlan(plan, recoverable)
  }
}

// Legacy metrics require numeric capacities. Keep their established unavailable sentinel;
// the independent storage fact reports UNKNOWN and owns admission, while heartbeats stay live.
async function readLegacyStorageSnapshot(
  purpose: WorkerStorageSnapshot['purpose'],
  path: string,
): Promise<WorkerStorageSnapshot> {
  return readStorageSnapshot(purpose, path).catch(() => ({
    purpose,
    totalBytes: 0,
    availableBytes: 0,
    totalInodes: null,
    availableInodes: null,
  }))
}

async function inspectStorage(
  purpose: WorkerStorageSnapshot['purpose'],
  path: string,
  checkName: 'IDENTITY_STORAGE' | 'PROFILE_STORAGE' | 'TEMPORARY_STORAGE',
): Promise<{ readonly check: WorkerProbeCheck; readonly storage: WorkerStorageSnapshot }> {
  const probePath = join(path, `.browshare-write-probe-${createPublicId()}`)
  let writable = false
  try {
    await mkdir(path, { recursive: true, mode: 0o700 })
    const handle = await open(probePath, 'wx', 0o600)
    await handle.close()
    await unlink(probePath)
    writable = true
  } catch {
    await unlink(probePath).catch(() => undefined)
  }
  const storage = await readLegacyStorageSnapshot(purpose, path)
  const check: WorkerProbeCheck = writable
    ? { name: checkName, status: 'PASS', code: null, summary: null, guidance: null }
    : {
        name: checkName,
        status: 'FAIL',
        code: 'STORAGE_NOT_WRITABLE',
        summary: `${purpose} storage is not writable by the Worker process.`,
        guidance: 'Check the mounted volume ownership and permissions for the Worker runtime user.',
      }
  return { check, storage }
}

async function inspectChrome(
  executable: string,
  expectedVersion: string,
): Promise<{
  readonly version: string | null
  readonly binaryCheck: WorkerProbeCheck
  readonly versionCheck: WorkerProbeCheck
}> {
  try {
    const result = await execFileAsync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    })
    const output = result.stdout.trim()
    const match = /^Google Chrome\s+([0-9]+(?:\.[0-9]+){3})$/u.exec(output)
    if (match === null) {
      return {
        version: null,
        binaryCheck: {
          name: 'CHROME_BINARY',
          status: 'PASS',
          code: null,
          summary: null,
          guidance: null,
        },
        versionCheck: {
          name: 'CHROME_VERSION',
          status: 'FAIL',
          code: 'CHROME_PRODUCT_UNSUPPORTED',
          summary: 'The configured executable is not Google Chrome Stable.',
          guidance:
            'Install the pinned google-chrome-stable package and update the Worker executable path.',
        },
      }
    }
    const version = match[1]!
    return {
      version,
      binaryCheck: {
        name: 'CHROME_BINARY',
        status: 'PASS',
        code: null,
        summary: null,
        guidance: null,
      },
      versionCheck: versionCheck(
        'CHROME_VERSION',
        version,
        expectedVersion,
        'Install the Google Chrome Stable version pinned by the BrowShare compatibility manifest.',
      ),
    }
  } catch {
    return {
      version: null,
      binaryCheck: {
        name: 'CHROME_BINARY',
        status: 'FAIL',
        code: 'CHROME_BINARY_UNAVAILABLE',
        summary: 'The configured Google Chrome Stable executable could not be run.',
        guidance: 'Install google-chrome-stable and configure BROWSHARE_WORKER_CHROME_EXECUTABLE.',
      },
      versionCheck: {
        name: 'CHROME_VERSION',
        status: 'NOT_RUN',
        code: 'CHROME_BINARY_UNAVAILABLE',
        summary: 'Chrome version could not be checked because the executable is unavailable.',
        guidance: 'Resolve the Chrome executable check first.',
      },
    }
  }
}

function hostPlatformCheck(): WorkerProbeCheck {
  if (platform() === 'linux' && arch() === 'x64') {
    return { name: 'HOST_PLATFORM', status: 'PASS', code: null, summary: null, guidance: null }
  }
  return {
    name: 'HOST_PLATFORM',
    status: 'FAIL',
    code: 'HOST_PLATFORM_UNSUPPORTED',
    summary: `The Worker host reports ${platform()}/${arch()}, but the supported runtime is linux/x64.`,
    guidance: 'Deploy the official linux/amd64 Worker image for a supported browser runtime.',
  }
}

function versionCheck(
  name: 'CHROME_VERSION' | 'REMOTE_TAB_CORE' | 'EXTENSION_VERSION',
  actual: string | null,
  expected: string,
  guidance: string,
): WorkerProbeCheck {
  if (actual === expected) {
    return { name, status: 'PASS', code: null, summary: null, guidance: null }
  }
  return {
    name,
    status: actual === null ? 'NOT_RUN' : 'FAIL',
    code: actual === null ? 'RUNTIME_COMPONENT_UNAVAILABLE' : 'RUNTIME_VERSION_MISMATCH',
    summary:
      actual === null
        ? `${versionComponentName(name)} version is unavailable.`
        : `${versionComponentName(name)} version ${actual} does not match required version ${expected}.`,
    guidance,
  }
}

function versionComponentName(
  name: 'CHROME_VERSION' | 'REMOTE_TAB_CORE' | 'EXTENSION_VERSION',
): string {
  if (name === 'CHROME_VERSION') return 'Chrome'
  if (name === 'EXTENSION_VERSION') return 'Extension'
  return 'Remote Tab Core'
}

async function resolveInstalledPackageVersion(packageName: string): Promise<string | null> {
  let entryPath: string
  try {
    entryPath = createRequire(import.meta.url).resolve(packageName)
  } catch {
    return null
  }
  let directory = dirname(entryPath)
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const value = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as unknown
      if (
        typeof value === 'object' &&
        value !== null &&
        'name' in value &&
        value.name === packageName &&
        'version' in value &&
        typeof value.version === 'string'
      ) {
        return value.version
      }
    } catch {
      // Continue towards the package root; bundled output may have no adjacent package.json.
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

function readCpuTimes(): CpuTimesSnapshot {
  return cpus().reduce(
    (result, cpu) => {
      result.idle += cpu.times.idle
      result.total += sumCpuTimes(cpu)
      return result
    },
    { idle: 0, total: 0 },
  )
}

function sumCpuTimes(cpu: CpuInfo): number {
  return cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
}

async function readLinuxNetworkCounters(): Promise<{
  readonly receivedBytes: number | null
  readonly transmittedBytes: number | null
}> {
  if (platform() !== 'linux') return { receivedBytes: null, transmittedBytes: null }
  let source: string
  try {
    source = await readFile('/proc/net/dev', 'utf8')
  } catch {
    return { receivedBytes: null, transmittedBytes: null }
  }
  let receivedBytes = 0
  let transmittedBytes = 0
  let matched = false
  for (const line of source.split('\n').slice(2)) {
    const match = /^\s*([^:]+):\s*(\d+)\s+(?:\d+\s+){7}(\d+)/u.exec(line)
    if (match === null || match[1]!.trim() === 'lo') continue
    receivedBytes += Number(match[2])
    transmittedBytes += Number(match[3])
    matched = true
  }
  return matched
    ? {
        receivedBytes: clampSafeInteger(receivedBytes),
        transmittedBytes: clampSafeInteger(transmittedBytes),
      }
    : { receivedBytes: null, transmittedBytes: null }
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function finiteNonNegative(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, value)
}

function clampSafeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))
}
