import { cleanupError } from './cleanup-error.js'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { createPublicId, isPublicId } from '@browshare/common'
import type {
  WorkerProbeCheck,
  StoragePolicy,
  ProfileStoragePolicy,
  WorkerStorageFact,
  ProfileStorageUsage,
  WorkerProfileRuntimeFact,
  WorkerSessionRuntimeFact,
  WorkerSessionClosedFact,
  WorkerSnapshotAcceptedMessage,
} from '@browshare/contracts'

import type { RemoteTabRuntimeConfiguration, WorkerConfiguration } from './configuration.js'
import {
  WorkerTabSessions,
  WorkerSessionError,
  type CreateWorkerTabSession,
  type WorkerSessionCloseOptions,
  type WorkerTabSessionAuthorization,
  type SessionCorePort,
  type SessionViewerTicketRequest,
  type SessionViewerTicket,
} from './tab-sessions.js'

import { WorkerExtensionRelease } from './extension-release.js'
import { WorkerRetainedDownloads } from './retained-downloads.js'
import { StorageProtection } from './storage-protection.js'
import { ProfileProxyAdapter, type ProfileProxyConfiguration } from './proxy-adapter.js'
import {
  ProfileChromeRuntime,
  deleteProfileDirectory,
  cleanupCapabilityDirectories,
  ProfileChromeError,
  type ProfileChromeAddress,
} from './profile-chrome.js'
import type {
  RemoteTabRuntimeMetricsSnapshot,
  RemoteTabRuntimeObserver,
  RemoteTabRuntimeProbeSnapshot,
} from './runtime-monitor.js'

interface ChromeVersion {
  readonly product: string
}

interface AttachedTab {
  readonly targetId: string
  readonly tabId: number
  readonly controller: { close(): Promise<void> }
}

interface CdpBrowserPort {
  getVersion(): Promise<ChromeVersion>
  listPageTargets(): Promise<readonly { readonly targetId: string }[]>
  attachTab(
    attachment: { readonly mode: 'create'; readonly initialUrl: string },
    resolver: Pick<ExtensionLoopbackPort, 'resolveTabId' | 'releaseTarget'>,
  ): Promise<AttachedTab>
  close(): void
}

interface ExtensionRuntimeStatus {
  readonly extensionId: string
  readonly serviceWorkerVersion?: string
  readonly mediaVersion?: string
  readonly coherent: boolean
}

interface MediaSignal {
  readonly type: string
  readonly sessionId: string
  readonly error?: { readonly code: string }
}

interface ExtensionLoopbackPort {
  start(): Promise<{ readonly host: '127.0.0.1' | '::1'; readonly port: number }>
  close(): Promise<void>
  waitUntilReady(roles: readonly ('service-worker' | 'media')[], timeoutMs: number): Promise<void>
  getRuntimeStatuses(): readonly ExtensionRuntimeStatus[]
  resolveTabId(request: { readonly targetId: string }): Promise<number>
  bindSession(sessionId: string, targetId: string): void
  prepareCapture(request: {
    readonly sessionId: string
    readonly targetId: string
    readonly tabId: number
    readonly viewerGeneration: number
  }): Promise<string>
  startMedia(request: {
    readonly sessionId: string
    readonly viewerGeneration: number
    readonly tabId: number
    readonly streamId: string
    readonly capabilities: readonly string[]
    readonly iceServers: readonly unknown[]
    readonly iceTransportPolicy: 'all'
    readonly viewport: {
      readonly width: number
      readonly height: number
      readonly deviceScaleFactor: number
      readonly frameRate: number
      readonly revision: number
    }
    readonly audio: boolean
  }): void
  sendMediaPeerState(sessionId: string, connected: boolean): void
  stopMedia(sessionId: string, reason: string): Promise<void>
  onMediaSignal(listener: (signal: MediaSignal) => void): () => void
  releaseSession(sessionId: string): void
  releaseTarget(targetId: string): void
}

interface RemoteTabCorePort extends SessionCorePort {
  close(reason?: string): Promise<void>
}

interface RemoteTabPackages {
  readonly RemoteTabError: new (
    code: 'FILE_LIMIT_EXCEEDED' | 'FILE_TRANSFER_FAILED' | 'SESSION_CLOSED',
    message: string,
  ) => Error
  readonly coreVersion: string
  readonly capabilities: readonly string[]
  readonly CdpBrowser: {
    connect(
      endpoint: string,
      options?: { readonly requestTimeoutMs?: number },
    ): Promise<CdpBrowserPort>
  }
  readonly ExtensionLoopbackServer: new (options: {
    readonly host: '127.0.0.1' | '::1'
    readonly port: number
    readonly extensionId: string
    readonly runtimeGeneration: string
    readonly runtimeSecret: string
    readonly requestTimeoutMs: number
  }) => ExtensionLoopbackPort
  readonly RemoteTabCore: new (options: {
    readonly extension: ExtensionLoopbackPort
    readonly downloadDirectory: string
  }) => RemoteTabCorePort
}

interface RegisteredProfileRuntime {
  fact: WorkerProfileRuntimeFact
  readonly stop: (reason: string) => Promise<void>
}

interface RegisteredSessionRuntime {
  fact: WorkerSessionRuntimeFact
  readonly close: (reason: string, options?: WorkerSessionCloseOptions) => Promise<void>
}

type RuntimeOwnerConfiguration = Pick<
  WorkerConfiguration,
  | 'chromeExecutable'
  | 'expectedChromeVersion'
  | 'identityDirectory'
  | 'storageThresholds'
  | 'profileStorageDirectory'
  | 'temporaryStorageDirectory'
  | 'remoteTabRuntime'
>

export interface StartProfileRuntimeInput {
  readonly profileId: string
  readonly requireExistingData: boolean
  readonly runtimeId: string
  readonly generation: number
  readonly routeVersion?: number
  readonly workerStoragePolicy?: StoragePolicy
  readonly profileStoragePolicy?: ProfileStoragePolicy
  readonly proxy: ProfileProxyConfiguration
  readonly healthcheckUrl: string
}

interface ManagedProfileRuntime {
  readonly input: StartProfileRuntimeInput
  readonly chrome: ProfileChromeRuntime
  readonly start: Promise<ProfileChromeAddress>
  readonly unregister: () => void
  unregisterChrome?: () => void
  stopping: boolean
  healthTimer?: NodeJS.Timeout
  stop?: Promise<void>
}

interface BrowserRuntimeProbe {
  readonly chromeVersion: string | null
  readonly extensionVersion: string | null
  readonly cdpCheck: WorkerProbeCheck
  readonly extensionPolicyCheck: WorkerProbeCheck
  readonly extensionLoopbackCheck: WorkerProbeCheck
  readonly tabCaptureCheck: WorkerProbeCheck
  readonly webRtcCheck: WorkerProbeCheck
}

function browserRuntimeReady(
  probe: BrowserRuntimeProbe,
  expectedExtensionVersion: string,
): boolean {
  return (
    [
      probe.cdpCheck,
      probe.extensionPolicyCheck,
      probe.extensionLoopbackCheck,
      probe.tabCaptureCheck,
      probe.webRtcCheck,
    ].every((check) => check.status === 'PASS') &&
    probe.extensionVersion === expectedExtensionVersion
  )
}

const PASS = (name: WorkerProbeCheck['name']): WorkerProbeCheck => ({
  name,
  status: 'PASS',
  code: null,
  summary: null,
  guidance: null,
})

export class EmbeddedRemoteTabRuntime implements RemoteTabRuntimeObserver {
  readonly retainedDownloads: WorkerRetainedDownloads
  readonly storageProtection: StorageProtection
  readonly #configuration: RuntimeOwnerConfiguration & {
    readonly remoteTabRuntime: RemoteTabRuntimeConfiguration
  }
  readonly #packages: RemoteTabPackages
  readonly #extension: ExtensionLoopbackPort
  readonly #extensionRelease: WorkerExtensionRelease
  readonly #core: RemoteTabCorePort
  readonly #tabSessions: WorkerTabSessions
  readonly #cdpEndpoints = new Set<string>()
  readonly #profileRuntimes = new Map<string, RegisteredProfileRuntime>()
  readonly #sessions = new Map<string, RegisteredSessionRuntime>()
  readonly #closedSessions = new Map<string, WorkerSessionClosedFact>()
  readonly #managedProfiles = new Map<string, ManagedProfileRuntime>()
  #bypassEndpoints: readonly { host: '127.0.0.1' | '::1'; port: number }[] = []
  #probeChrome: ProfileChromeRuntime | undefined
  #probePromise: Promise<RemoteTabRuntimeProbeSnapshot> | undefined
  #started = false
  #closed = false
  #downloadExpiryTimer: NodeJS.Timeout | undefined
  #downloadExpiry: Promise<void> | undefined

  private constructor(
    configuration: RuntimeOwnerConfiguration & {
      readonly remoteTabRuntime: RemoteTabRuntimeConfiguration
    },
    packages: RemoteTabPackages,
  ) {
    this.#configuration = configuration
    this.#packages = packages
    this.storageProtection = new StorageProtection(
      configuration.identityDirectory,
      configuration.profileStorageDirectory,
      configuration.temporaryStorageDirectory,
      configuration.storageThresholds,
    )
    this.#extension = new packages.ExtensionLoopbackServer({
      host: configuration.remoteTabRuntime.extensionHost,
      port: configuration.remoteTabRuntime.extensionPort,
      extensionId: configuration.remoteTabRuntime.extensionId,
      runtimeGeneration: configuration.remoteTabRuntime.runtimeGeneration,
      runtimeSecret: configuration.remoteTabRuntime.runtimeSecret,
      requestTimeoutMs: configuration.remoteTabRuntime.requestTimeoutMilliseconds,
    })
    this.#extensionRelease = new WorkerExtensionRelease(configuration.remoteTabRuntime)
    const downloadDirectory = join(configuration.temporaryStorageDirectory, '.browser-downloads')
    this.retainedDownloads = new WorkerRetainedDownloads(
      join(configuration.temporaryStorageDirectory, 'retained-downloads'),
      { completedMilliseconds: 30 * 60 * 1_000, afterSessionMilliseconds: 10 * 60 * 1_000 },
      { storage: this.storageProtection, spoolDirectory: downloadDirectory },
      (code, message) => new packages.RemoteTabError(code, message),
    )
    this.#core = new packages.RemoteTabCore({
      extension: this.#extension,
      downloadDirectory,
    })
    this.#tabSessions = new WorkerTabSessions(
      this.#core,
      configuration.temporaryStorageDirectory,
      {
        checkProxyHealth: async (profileId) => {
          const entry = this.#managedProfiles.get(profileId)
          if (!entry || entry.stopping) throw new Error('Session Profile is not running')
          // Runtime owns the network observation; Sessions only consume the shared fact.
          return this.#profileRuntimes.get(profileId)?.fact.proxyHealth?.status === 'HEALTHY'
        },
        resolveProfile: async (request) => {
          if (request.workerStoragePolicy)
            await this.storageProtection.applyPolicy(
              request.workerStoragePolicy,
              request.profileStoragePolicy,
            )
          await this.storageProtection.assertCanStart(
            request.profileId,
            request.workerStoragePolicy,
            request.profileStoragePolicy,
          )
          const entry = this.#managedProfiles.get(request.profileId)
          if (
            entry === undefined ||
            entry.stopping ||
            entry.input.runtimeId !== request.runtimeId ||
            entry.input.generation !== request.profileGeneration
          )
            throw new WorkerSessionError(
              'PROFILE_GENERATION_MISMATCH',
              'Session targets an unavailable Profile generation',
            )
          const address = await entry.start
          if (
            entry.stopping ||
            this.#profileRuntimes.get(request.profileId)?.fact.state !== 'RUNNING'
          )
            throw new WorkerSessionError('PROFILE_NOT_RUNNING', 'Session Profile is not running')
          if (
            this.#profileRuntimes.get(request.profileId)?.fact.proxyHealth?.status === 'UNHEALTHY'
          )
            throw new WorkerSessionError(
              'PROFILE_PROXY_UNHEALTHY',
              'The Profile route is unhealthy',
            )
          return address.cdpEndpoint
        },
        publish: (fact) => {
          if (this.#sessions.has(fact.sessionId)) this.updateSession(fact)
          else
            this.registerSession(fact, (reason, options) =>
              this.#tabSessions.closeSession(fact.sessionId, reason, undefined, options),
            )
        },
        remove: (sessionId) => {
          this.#sessions.delete(sessionId)
        },
        closed: (fact) => {
          this.#closedSessions.set(fact.sessionId, fact)
        },
        onPageScriptError: (sessionId, error) => {
          process.stderr.write(
            JSON.stringify({
              level: 'warn',
              event: 'page_script.failed',
              sessionId,
              code: error.code,
              versionId: error.versionId,
              occurredAt: error.occurredAt,
            }) + '\n',
          )
        },
        onCleanupError: (sessionId, cause) => {
          process.stderr.write(
            JSON.stringify({
              level: 'error',
              event: 'session.cleanup.failed',
              sessionId,
              code: errorCode(cause) ?? 'SESSION_CLEANUP_FAILED',
            }) + '\n',
          )
        },
      },
      this.retainedDownloads,
      (code, message) => new packages.RemoteTabError(code, message),
      this.storageProtection,
    )
  }

  static async create(
    configuration: RuntimeOwnerConfiguration & {
      readonly remoteTabRuntime: RemoteTabRuntimeConfiguration
    },
  ): Promise<EmbeddedRemoteTabRuntime> {
    return new EmbeddedRemoteTabRuntime(configuration, await loadRemoteTabPackages())
  }

  async start(): Promise<void> {
    if (this.#closed) throw new Error('Remote Tab runtime is closed')
    if (this.#started) throw new Error('Remote Tab runtime is already started')
    await this.storageProtection.initialize()
    await cleanupCapabilityDirectories(this.#configuration.temporaryStorageDirectory)
    await this.retainedDownloads.initialize()
    // Chrome Sessions cannot survive a Worker restart; never renew an already persisted end time.
    const restartedAt = Date.now()
    for (const sessionId of new Set(this.retainedDownloads.list().map((file) => file.sessionId)))
      await this.retainedDownloads.endSession(sessionId, restartedAt)
    // No previous Core Session is recoverable in this process. Only the durable inbox survives.
    await rm(join(this.#configuration.temporaryStorageDirectory, 'sessions'), {
      recursive: true,
      force: true,
    })
    await rm(join(this.#configuration.temporaryStorageDirectory, '.browser-downloads'), {
      recursive: true,
      force: true,
    })
    await mkdir(join(this.#configuration.temporaryStorageDirectory, '.browser-downloads'), {
      recursive: true,
      mode: 0o700,
    })
    const extensionAddress = await this.#extension.start()
    try {
      const release = await this.#extensionRelease.start(extensionAddress)
      this.#bypassEndpoints = [extensionAddress, { host: release.host, port: release.port }]
    } catch (cause) {
      await this.#extension.close().catch(() => undefined)
      throw cause
    }
    await this.storageProtection.refresh()
    this.#started = true
    this.#scheduleDownloadExpiry()
  }

  #scheduleDownloadExpiry(): void {
    if (this.#closed) return
    this.#downloadExpiryTimer = setTimeout(() => {
      this.#downloadExpiryTimer = undefined
      this.#downloadExpiry = this.retainedDownloads.expire()
      void this.#downloadExpiry
        .catch(() => {
          process.stderr.write(
            JSON.stringify({ level: 'error', event: 'download.expiry.failed' }) + '\n',
          )
        })
        .finally(() => this.#scheduleDownloadExpiry())
    }, 1_000)
    this.#downloadExpiryTimer.unref()
  }

  async startProfileRuntime(input: StartProfileRuntimeInput): Promise<ProfileChromeAddress> {
    this.#assertRunning()
    if (
      !isPublicId(input.profileId) ||
      !isPublicId(input.runtimeId) ||
      !Number.isSafeInteger(input.generation) ||
      input.generation < 0 ||
      (input.routeVersion !== undefined &&
        (!Number.isSafeInteger(input.routeVersion) || input.routeVersion < 1))
    ) {
      throw new TypeError('Invalid Profile Runtime identity')
    }
    if (typeof input.healthcheckUrl !== 'string')
      throw new TypeError('Profile startup requires an HTTPS route health check')
    const existing = this.#managedProfiles.get(input.profileId)
    if (existing !== undefined) {
      if (this.#profileRuntimes.get(input.profileId)?.fact.state === 'ERROR')
        throw new ProfileChromeError(
          'PROFILE_RUNTIME_FAILED',
          'Stop the failed Runtime before restarting the Profile',
        )
      if (
        existing.input.runtimeId === input.runtimeId &&
        existing.input.generation === input.generation &&
        !existing.stopping
      )
        return existing.start
      throw new ProfileChromeError(
        'PROFILE_RUNTIME_EXISTS',
        'Stop the existing Profile Runtime before starting another generation',
      )
    }
    if (input.workerStoragePolicy)
      await this.storageProtection.applyPolicy(
        input.workerStoragePolicy,
        input.profileStoragePolicy,
      )
    await this.storageProtection.assertCanStart(
      input.profileId,
      input.workerStoragePolicy,
      input.profileStoragePolicy,
    )
    // Admission yields for disk observation; another idempotent START may have claimed it.
    if (this.#managedProfiles.has(input.profileId)) return this.startProfileRuntime(input)
    const chrome = new ProfileChromeRuntime({
      profileId: input.profileId,
      requireExistingData: input.requireExistingData,
      storageDirectory: this.#configuration.profileStorageDirectory,
      chromeExecutable: this.#configuration.chromeExecutable,
      expectedChromeVersion: this.#configuration.expectedChromeVersion,
      extensionId: this.#configuration.remoteTabRuntime.extensionId,
      bypassEndpoints: this.#bypassEndpoints,
      proxy: input.proxy,
      healthcheckUrl: input.healthcheckUrl,
    })
    const fact: WorkerProfileRuntimeFact = {
      profileId: input.profileId,
      runtimeId: input.runtimeId,
      generation: input.generation,
      routeVersion: input.routeVersion ?? 1,
      proxyHealth: null,
      state: 'STARTING',
      chromeProcessId: null,
      startedAt: new Date().toISOString(),
    }
    const unregister = this.registerProfileRuntime(fact, (reason) =>
      this.stopProfileRuntime(input.profileId, reason),
    )
    const deferred = Promise.withResolvers<ProfileChromeAddress>()
    const entry: ManagedProfileRuntime = {
      input: { ...input },
      chrome,
      start: deferred.promise,
      unregister,
      stopping: false,
    }
    this.#managedProfiles.set(input.profileId, entry)
    void (async () => {
      try {
        const address = await chrome.start()
        entry.unregisterChrome = this.registerChromeRuntime(address.cdpEndpoint)
        this.updateProfileRuntime({ ...fact, chromeProcessId: address.chromeProcessId })
        // Probe the new Chrome endpoint, not another Profile already connected to the loopback.
        // Extension force-install and its offscreen role can finish after CDP starts listening.
        const probe = await this.#waitForBrowserRuntime(address.cdpEndpoint, () => entry.stopping)
        if (!browserRuntimeReady(probe, this.#configuration.remoteTabRuntime.extensionVersion))
          throw new ProfileChromeError(
            'PROFILE_EXTENSION_NOT_READY',
            'The Profile Extension and media runtime did not become ready',
          )
        if (entry.stopping || this.#closed)
          throw new ProfileChromeError('RUNTIME_CLOSED', 'Profile Runtime startup was cancelled')
        this.updateProfileRuntime({
          ...fact,
          state: 'RUNNING',
          chromeProcessId: address.chromeProcessId,
          proxyHealth:
            address.proxyHealth === null
              ? null
              : {
                  ...address.proxyHealth,
                  lastSucceededAt:
                    address.proxyHealth.status === 'HEALTHY' ? address.proxyHealth.checkedAt : null,
                },
        })
        this.#observeProfileRoute(input.profileId, entry)
        const onExit = async (browserClosed: boolean) => {
          if (entry.stopping || this.#closed) return
          clearTimeout(entry.healthTimer)
          entry.chrome.cancelRouteHealthChecks()
          const current = this.#profileRuntimes.get(input.profileId)?.fact
          if (current !== undefined)
            this.updateProfileRuntime({
              ...current,
              state: 'ERROR',
              chromeProcessId: browserClosed ? null : current.chromeProcessId,
            })
          if (browserClosed) entry.unregisterChrome?.()
          await this.#closeProfileSessions(input.profileId, 'PROFILE_CHROME_EXITED', {
            browserClosed,
          })
        }
        void chrome.exited
          .then(
            () => onExit(true),
            () => onExit(false),
          )
          .catch(() => {
            // Failed Session cleanup stays registered for reconciliation or explicit stop.
          })
        deferred.resolve(address)
      } catch (cause) {
        clearTimeout(entry.healthTimer)
        entry.chrome.cancelRouteHealthChecks()
        if (!entry.stopping && this.#profileRuntimes.has(input.profileId))
          this.updateProfileRuntime({ ...fact, state: 'ERROR', chromeProcessId: null })
        await chrome.stop()
        entry.unregisterChrome?.()
        entry.unregister()
        if (this.#managedProfiles.get(input.profileId) === entry)
          this.#managedProfiles.delete(input.profileId)
        deferred.reject(cause)
      }
    })().catch(deferred.reject)
    return entry.start
  }

  getMediaMetrics(): string[] {
    return this.#tabSessions.readMediaMetrics()
  }

  createTabSession(
    request: CreateWorkerTabSession,
    authorization: WorkerTabSessionAuthorization,
  ): Promise<WorkerSessionRuntimeFact> {
    this.#assertRunning()
    if (
      request.capabilities.some((capability) => !this.#packages.capabilities.includes(capability))
    )
      throw new WorkerSessionError(
        'CAPABILITY_UNAVAILABLE',
        'Requested Session capability is unavailable on this Worker.',
      )
    return this.#tabSessions.create(request, authorization)
  }

  createSessionViewerTicket(
    sessionId: string,
    request: Omit<SessionViewerTicketRequest, 'sessionId'>,
  ): Promise<SessionViewerTicket> {
    this.#assertRunning()
    return this.#tabSessions.createViewerTicket(sessionId, request)
  }

  continueTabSession(sessionId: string, viewerGeneration: number): WorkerSessionRuntimeFact {
    this.#assertRunning()
    return this.#tabSessions.continueSession(sessionId, viewerGeneration)
  }

  renewSessionLease(sessionId: string, leaseExpiresAt: string): WorkerSessionRuntimeFact {
    this.#assertRunning()
    return this.#tabSessions.renewLease(sessionId, leaseExpiresAt)
  }

  async prepareSessionViewerTicket(ticket: SessionViewerTicket): Promise<WorkerSessionRuntimeFact> {
    this.#assertRunning()
    const claims = ticket.claims
    await this.#tabSessions.createViewerTicket(
      claims.sessionId,
      {
        viewerGeneration: claims.viewerGeneration,
        gatewayId: claims.gatewayId,
        capabilities: claims.capabilities,
        expiresInSeconds: 60,
      },
      ticket,
    )
    const fact = (await this.readRuntimeFacts()).sessions.find(
      (session) => session.sessionId === claims.sessionId,
    )
    if (fact === undefined) throw new Error('Session ended before Viewer preparation completed')
    return fact
  }

  closeTabSession(sessionId: string, reason: string, creationExpiresAt?: string): Promise<void> {
    return this.#tabSessions.closeSession(sessionId, reason, creationExpiresAt)
  }

  stopProfileRuntime(profileId: string, reason = 'Profile Runtime stopped'): Promise<void> {
    const entry = this.#managedProfiles.get(profileId)
    if (entry === undefined) return Promise.resolve()
    entry.stop ??= this.#stopManagedProfile(profileId, entry, reason).catch((cause) => {
      delete entry.stop
      const runtime = this.#profileRuntimes.get(profileId)
      if (runtime) runtime.fact = { ...runtime.fact, cleanupError: cleanupError(cause) }
      throw cause
    })
    return entry.stop
  }

  async deleteProfileRuntime(profileId: string): Promise<void> {
    this.#assertRunning()
    if (!isPublicId(profileId)) throw new TypeError('Profile ID must be a UUIDv7')
    await this.stopProfileRuntime(profileId, 'PROFILE_DELETED')
    // Retry any Session cleanup left registered by a previous failed stop before deleting storage.
    await this.#closeProfileSessions(profileId, 'PROFILE_DELETED')
    await deleteProfileDirectory(this.#configuration.profileStorageDirectory, profileId)
    await this.storageProtection.forgetProfile(profileId)
  }

  async #stopManagedProfile(
    profileId: string,
    entry: ManagedProfileRuntime,
    reason: string,
  ): Promise<void> {
    entry.stopping = true
    clearTimeout(entry.healthTimer)
    entry.chrome.cancelRouteHealthChecks()
    const record = this.#profileRuntimes.get(profileId)
    if (record !== undefined) this.updateProfileRuntime({ ...record.fact, state: 'STOPPING' })
    await this.#closeProfileSessions(profileId, reason).catch(() => undefined)
    await entry.chrome.stop()
    // A drained owned Chrome group is stronger proof than a failed CDP close. Finish pending
    // Session/file cleanup before removing its Profile mapping from the next snapshot.
    if (record !== undefined) this.updateProfileRuntime({ ...record.fact, chromeProcessId: null })
    await this.#closeProfileSessions(profileId, reason, { browserClosed: true })
    entry.unregisterChrome?.()
    entry.unregister()
    if (this.#managedProfiles.get(profileId) === entry) this.#managedProfiles.delete(profileId)
  }

  #observeProfileRoute(profileId: string, entry: ManagedProfileRuntime): void {
    const current = () =>
      !entry.stopping &&
      !this.#closed &&
      this.#managedProfiles.get(profileId) === entry &&
      this.#profileRuntimes.get(profileId)?.fact.state === 'RUNNING'
    if (!current()) return
    void Promise.resolve()
      .then(() => entry.chrome.checkRouteHealth())
      .catch(() => ({
        status: 'UNHEALTHY' as const,
        checkedAt: new Date().toISOString(),
        latencyMilliseconds: 0,
        httpStatus: null,
        errorCode: 'PROXY_CONNECT_FAILED' as const,
      }))
      .then((health) => {
        if (!current()) return
        const fact = this.#profileRuntimes.get(profileId)!.fact
        this.updateProfileRuntime({
          ...fact,
          proxyHealth: {
            ...health,
            lastSucceededAt:
              health.status === 'HEALTHY'
                ? health.checkedAt
                : (fact.proxyHealth?.lastSucceededAt ?? null),
          },
        })
        entry.healthTimer = setTimeout(() => this.#observeProfileRoute(profileId, entry), 5_000)
        entry.healthTimer.unref()
      })
      .catch(() => {
        // Runtime retirement can race an in-flight observation. Its identity check owns removal.
      })
  }

  async #closeProfileSessions(
    profileId: string,
    reason: string,
    options?: WorkerSessionCloseOptions,
  ): Promise<void> {
    const results = await Promise.allSettled(
      [...this.#sessions.values()]
        .filter((entry) => entry.fact.profileId === profileId)
        .map(async (entry) => {
          await entry.close(reason, options)
          this.#sessions.delete(entry.fact.sessionId)
        }),
    )
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }

  registerChromeRuntime(cdpEndpoint: string): () => void {
    assertLoopbackCdpEndpoint(cdpEndpoint)
    this.#cdpEndpoints.add(cdpEndpoint)
    return () => this.#cdpEndpoints.delete(cdpEndpoint)
  }

  registerProfileRuntime(
    fact: WorkerProfileRuntimeFact,
    stop: (reason: string) => Promise<void>,
  ): () => void {
    if (this.#profileRuntimes.has(fact.profileId)) {
      throw new Error('Profile Runtime is already registered with this Worker runtime')
    }
    const entry: RegisteredProfileRuntime = { fact: { ...fact }, stop }
    this.#profileRuntimes.set(fact.profileId, entry)
    return () => {
      if (this.#profileRuntimes.get(fact.profileId) === entry) {
        this.#profileRuntimes.delete(fact.profileId)
      }
    }
  }

  updateProfileRuntime(fact: WorkerProfileRuntimeFact): void {
    const entry = this.#profileRuntimes.get(fact.profileId)
    if (entry === undefined) throw new Error('Profile Runtime is not registered')
    if (entry.fact.runtimeId !== fact.runtimeId || entry.fact.generation !== fact.generation) {
      throw new Error('Profile Runtime identity cannot change in place')
    }
    entry.fact = { ...fact }
  }

  registerSession(
    fact: WorkerSessionRuntimeFact,
    close: (reason: string, options?: WorkerSessionCloseOptions) => Promise<void>,
  ): () => void {
    if (this.#sessions.has(fact.sessionId)) {
      throw new Error('Remote Tab Session is already registered with this Worker runtime')
    }
    const profile = this.#profileRuntimes.get(fact.profileId)
    if (
      profile === undefined ||
      profile.fact.runtimeId !== fact.runtimeId ||
      profile.fact.generation !== fact.profileGeneration
    ) {
      throw new WorkerSessionError(
        'PROFILE_GENERATION_MISMATCH',
        'Remote Tab Session must reference a registered Profile Runtime generation',
      )
    }
    const entry: RegisteredSessionRuntime = { fact: { ...fact }, close }
    this.#sessions.set(fact.sessionId, entry)
    return () => {
      if (this.#sessions.get(fact.sessionId) === entry) this.#sessions.delete(fact.sessionId)
    }
  }

  updateSession(fact: WorkerSessionRuntimeFact): void {
    const entry = this.#sessions.get(fact.sessionId)
    if (entry === undefined) throw new Error('Remote Tab Session is not registered')
    if (
      entry.fact.profileId !== fact.profileId ||
      entry.fact.runtimeId !== fact.runtimeId ||
      entry.fact.profileGeneration !== fact.profileGeneration
    ) {
      throw new Error('Remote Tab Session ownership cannot change in place')
    }
    entry.fact = { ...fact }
  }

  probe(): Promise<RemoteTabRuntimeProbeSnapshot> {
    this.#assertRunning()
    this.#probePromise ??= this.#probeOwnedChrome().finally(() => {
      this.#probePromise = undefined
    })
    return this.#probePromise
  }

  async #probeOwnedChrome(): Promise<RemoteTabRuntimeProbeSnapshot> {
    const proxyAdapterCheck = await probeLoopbackAdapter()
    let directory: string | undefined
    let chrome: ProfileChromeRuntime | undefined
    let sandboxCheck = notRun('CHROME_SANDBOX', 'Managed probe Chrome has not started.')
    let browserProbe: BrowserRuntimeProbe = {
      chromeVersion: null,
      extensionVersion: null,
      cdpCheck: notRun('CDP_LOOPBACK', 'Managed probe Chrome has not started.'),
      extensionPolicyCheck: notRun('EXTENSION_POLICY', 'Managed probe Chrome has not started.'),
      extensionLoopbackCheck: notRun('EXTENSION_LOOPBACK', 'Managed probe Chrome has not started.'),
      tabCaptureCheck: notRun('TAB_CAPTURE', 'Managed probe Chrome has not started.'),
      webRtcCheck: notRun('WEBRTC', 'Managed probe Chrome has not started.'),
    }
    try {
      directory = await mkdtemp(join(this.#configuration.temporaryStorageDirectory, '.capability-'))
      this.#assertRunning()
      chrome = new ProfileChromeRuntime({
        profileId: createPublicId(),
        storageDirectory: directory,
        chromeExecutable: this.#configuration.chromeExecutable,
        expectedChromeVersion: this.#configuration.expectedChromeVersion,
        extensionId: this.#configuration.remoteTabRuntime.extensionId,
        bypassEndpoints: this.#bypassEndpoints,
        proxy: { type: 'DIRECT' },
      })
      this.#probeChrome = chrome
      const address = await chrome.start()
      sandboxCheck = PASS('CHROME_SANDBOX')
      browserProbe = await this.#waitForBrowserRuntime(address.cdpEndpoint)
    } catch (cause) {
      const check = failed(
        'CDP_LOOPBACK',
        errorCode(cause) ?? 'CHROME_PROBE_START_FAILED',
        'The Worker could not start or complete its managed Chrome capability probe.',
        'Verify the pinned Chrome, sandbox dependencies, storage permissions and signed Extension release.',
      )
      if (sandboxCheck.status !== 'PASS') sandboxCheck = { ...check, name: 'CHROME_SANDBOX' }
      browserProbe = { ...browserProbe, cdpCheck: check }
    } finally {
      await chrome?.stop()
      this.#probeChrome = undefined
      if (directory !== undefined) await rm(directory, { recursive: true, force: true })
    }
    return {
      checks: [
        sandboxCheck,
        browserProbe.cdpCheck,
        browserProbe.extensionPolicyCheck,
        browserProbe.tabCaptureCheck,
        browserProbe.extensionLoopbackCheck,
        browserProbe.webRtcCheck,
        proxyAdapterCheck,
      ],
      chromeVersion: browserProbe.chromeVersion,
      remoteTabCoreVersion: this.#packages.coreVersion,
      extensionVersion: browserProbe.extensionVersion,
      supportedCapabilities: [...this.#packages.capabilities],
    }
  }

  async #waitForBrowserRuntime(
    cdpEndpoint: string,
    cancelled: () => boolean = () => false,
  ): Promise<BrowserRuntimeProbe> {
    const deadline = Date.now() + 45_000
    while (true) {
      if (this.#closed || cancelled())
        throw new ProfileChromeError('RUNTIME_CLOSED', 'Chrome readiness probe was cancelled')
      const probe = await this.#probeBrowserRuntime(cdpEndpoint, deadline, cancelled)
      if (
        browserRuntimeReady(probe, this.#configuration.remoteTabRuntime.extensionVersion) ||
        Date.now() >= deadline
      )
        return probe
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  async readMetrics(): Promise<RemoteTabRuntimeMetricsSnapshot> {
    this.#assertRunning()
    const results = await Promise.all(
      [...this.#cdpEndpoints].map(async (endpoint) => {
        let browser: CdpBrowserPort | undefined
        try {
          browser = await this.#packages.CdpBrowser.connect(endpoint, { requestTimeoutMs: 3_000 })
          return { reachable: true, tabs: (await browser.listPageTargets()).length }
        } catch {
          return { reachable: false, tabs: 0 }
        } finally {
          browser?.close()
        }
      }),
    )
    return {
      chromeInstances: results.filter((result) => result.reachable).length,
      tabs: results.reduce((total, result) => total + result.tabs, 0),
      activeSessions: this.#sessions.size,
    }
  }

  applyStoragePolicy(
    workerPolicy: StoragePolicy,
    profilePolicy?: ProfileStoragePolicy,
  ): Promise<void> {
    return this.storageProtection.applyPolicy(workerPolicy, profilePolicy)
  }

  readStorageFacts(): { storage: WorkerStorageFact; profileStorageUsage: ProfileStorageUsage[] } {
    return {
      storage: this.storageProtection.snapshot(),
      profileStorageUsage: this.storageProtection.profileUsages(),
    }
  }

  async readRuntimeFacts(): Promise<{
    profiles: WorkerProfileRuntimeFact[]
    sessions: WorkerSessionRuntimeFact[]
    closedSessions: WorkerSessionClosedFact[]
  }> {
    this.#assertRunning()
    return {
      profiles: [...this.#profileRuntimes.values()].map((entry) => ({
        ...entry.fact,
        storageUsage: this.storageProtection.profileUsage(entry.fact.profileId),
      })),
      sessions: [...this.#sessions.values()].map((entry) => ({ ...entry.fact })),
      closedSessions: [...this.#closedSessions.values()].map((fact) => ({ ...fact })),
    }
  }

  async applyReconciliationPlan(
    plan: Pick<
      WorkerSnapshotAcceptedMessage['payload'],
      'closeSessions' | 'stopProfiles' | 'leases' | 'closedSessionIds'
    >,
    recoverable = false,
  ): Promise<void> {
    this.#assertRunning()
    for (const sessionId of plan.closedSessionIds ?? []) this.#closedSessions.delete(sessionId)
    for (const grant of plan.leases ?? []) {
      const fact = this.#sessions.get(grant.sessionId)?.fact
      if (
        !fact ||
        fact.status === 'CLOSING' ||
        plan.closeSessions.some((action) => action.sessionId === grant.sessionId) ||
        plan.stopProfiles.some((action) => action.profileId === grant.profileId)
      )
        continue
      if (
        fact.profileId !== grant.profileId ||
        fact.runtimeId !== grant.runtimeId ||
        fact.profileGeneration !== grant.profileGeneration ||
        fact.tabId !== grant.tabId ||
        fact.targetId !== grant.targetId
      )
        throw new WorkerSessionError(
          'SESSION_MAPPING_CONFLICT',
          'Lease grant belongs to another Tab runtime',
        )
      if (
        Date.parse(grant.expiresAt) <= Date.now() ||
        Date.parse(fact.leaseExpiresAt ?? '') <= Date.now()
      )
        continue
      this.#tabSessions.renewLease(grant.sessionId, grant.expiresAt)
    }
    const stoppingProfiles = new Set<string>()
    const attempts: Promise<void>[] = []
    // A whole-Profile stop can prove Chrome exit even when an individual CDP close fails.
    // Independent targets settle separately; one failed cleanup never skips another target.
    for (const action of plan.stopProfiles) {
      const entry = this.#profileRuntimes.get(action.profileId)
      if (
        !entry ||
        entry.fact.runtimeId !== action.runtimeId ||
        entry.fact.generation !== action.generation
      )
        continue
      stoppingProfiles.add(action.profileId)
      attempts.push(
        Promise.resolve()
          .then(() => entry.stop(action.reason))
          .then(() => {
            if (this.#profileRuntimes.get(action.profileId) === entry)
              this.#profileRuntimes.delete(action.profileId)
          })
          .catch((cause) => {
            if (this.#profileRuntimes.get(action.profileId) === entry)
              entry.fact = { ...entry.fact, cleanupError: cleanupError(cause) }
            throw cause
          }),
      )
    }
    for (const action of plan.closeSessions) {
      const entry = this.#sessions.get(action.sessionId)
      if (!entry || stoppingProfiles.has(entry.fact.profileId)) continue
      attempts.push(
        Promise.resolve()
          .then(() => entry.close(action.reason))
          .then(() => {
            if (this.#sessions.get(action.sessionId) === entry)
              this.#sessions.delete(action.sessionId)
          })
          .catch((cause) => {
            if (this.#sessions.get(action.sessionId) === entry)
              entry.fact = { ...entry.fact, cleanupError: cleanupError(cause) }
            throw cause
          }),
      )
    }
    const results = await Promise.allSettled(attempts)
    if (!recoverable) {
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    clearTimeout(this.#downloadExpiryTimer)
    let failure: unknown
    try {
      await this.#downloadExpiry
    } catch (cause) {
      failure = cause
    }
    try {
      await this.#probeChrome?.stop()
      await this.#probePromise
    } catch (cause) {
      failure = cause
    }
    try {
      await this.#tabSessions.close()
    } catch (cause) {
      failure ??= cause
    }
    const stopped = await Promise.allSettled(
      [...this.#profileRuntimes.values()].map((entry) =>
        entry.stop('BrowShare Worker is shutting down'),
      ),
    )
    const rejected = stopped.find((result) => result.status === 'rejected')
    if (rejected?.status === 'rejected') failure ??= rejected.reason
    try {
      await this.#core.close('BrowShare Worker is shutting down')
    } catch (cause) {
      failure ??= cause
    }
    try {
      await this.#extensionRelease.close()
    } catch (cause) {
      failure ??= cause
    }
    try {
      await this.#extension.close()
    } catch (cause) {
      failure ??= cause
    }
    await this.storageProtection.close()
    this.#started = false
    this.#sessions.clear()
    this.#profileRuntimes.clear()
    if (failure !== undefined) throw failure
  }

  async #probeBrowserRuntime(
    cdpEndpoint: string,
    deadline: number,
    cancelled: () => boolean,
  ): Promise<BrowserRuntimeProbe> {
    const configuration = this.#configuration.remoteTabRuntime
    let browser: CdpBrowserPort | undefined
    let attached: AttachedTab | undefined
    let sessionId: string | undefined
    let mediaStarted = false
    let chromeVersion: string | null = null
    let cdpCheck = notRun('CDP_LOOPBACK', 'CDP has not been probed.')
    let extensionPolicyCheck = notRun(
      'EXTENSION_POLICY',
      'The fixed-ID Extension has not authenticated with the Worker loopback.',
    )
    let extensionLoopbackCheck = notRun(
      'EXTENSION_LOOPBACK',
      'Extension loopback roles have not been probed.',
    )
    let tabCaptureCheck = notRun(
      'TAB_CAPTURE',
      'Tab capture requires a reachable Chrome and coherent Extension runtime.',
    )
    let webRtcCheck = notRun('WEBRTC', 'WebRTC publisher creation requires successful tab capture.')

    try {
      browser = await this.#packages.CdpBrowser.connect(cdpEndpoint, {
        requestTimeoutMs: configuration.requestTimeoutMilliseconds,
      })
      const version = await browser.getVersion()
      chromeVersion = chromeVersionFromProduct(version.product)
      await browser.listPageTargets()
      cdpCheck = PASS('CDP_LOOPBACK')

      attached = await browser.attachTab(
        {
          mode: 'create',
          initialUrl:
            'data:text/html,<meta charset=utf-8><title>BrowShare capability probe</title>',
        },
        {
          // Keep this Chrome's probe Tab alive while its own Extension starts. Recreating
          // it after another Chrome reports "not found" interrupted startup in real Chrome probes.
          resolveTabId: async (request) => {
            while (true) {
              if (this.#closed || cancelled())
                throw new ProfileChromeError(
                  'RUNTIME_CLOSED',
                  'Chrome readiness probe was cancelled',
                )
              try {
                return await this.#extension.resolveTabId(request)
              } catch (cause) {
                if (
                  Date.now() >= deadline ||
                  !['EXTENSION_UNAVAILABLE', 'TARGET_MAPPING_FAILED'].includes(
                    errorCode(cause) ?? '',
                  )
                )
                  throw cause
                await new Promise((resolve) => setTimeout(resolve, 250))
              }
            }
          },
          releaseTarget: (targetId) => this.#extension.releaseTarget(targetId),
        },
      )

      let statuses: readonly ExtensionRuntimeStatus[]
      try {
        await this.#extension.waitUntilReady(
          ['service-worker', 'media'],
          configuration.requestTimeoutMilliseconds,
        )
        statuses = this.#extension.getRuntimeStatuses()
      } catch {
        statuses = this.#extension.getRuntimeStatuses()
        extensionPolicyCheck =
          statuses.length > 0
            ? PASS('EXTENSION_POLICY')
            : failed(
                'EXTENSION_POLICY',
                'EXTENSION_NOT_INSTALLED',
                'The fixed-ID Extension did not authenticate with the Worker loopback.',
                'Verify the force-install policy, Extension ID and managed runtime configuration.',
              )
        extensionLoopbackCheck = failed(
          'EXTENSION_LOOPBACK',
          'EXTENSION_ROLES_UNAVAILABLE',
          'The Extension service-worker and media roles did not become ready before the probe timeout.',
          'Start the Worker loopback before managed Chrome and inspect Extension runtime diagnostics.',
        )
        return {
          chromeVersion,
          extensionVersion: extensionVersionFor(statuses),
          cdpCheck,
          extensionPolicyCheck,
          extensionLoopbackCheck,
          tabCaptureCheck,
          webRtcCheck,
        }
      }
      const coherent = statuses.filter(
        (status) =>
          status.extensionId === configuration.extensionId &&
          status.coherent &&
          status.serviceWorkerVersion !== undefined &&
          status.mediaVersion !== undefined,
      )
      extensionPolicyCheck =
        statuses.length > 0
          ? PASS('EXTENSION_POLICY')
          : failed(
              'EXTENSION_POLICY',
              'EXTENSION_NOT_INSTALLED',
              'The fixed-ID Extension did not authenticate with the Worker loopback.',
              'Verify the force-install policy, Extension ID and managed runtime configuration.',
            )
      extensionLoopbackCheck =
        coherent.length > 0
          ? PASS('EXTENSION_LOOPBACK')
          : failed(
              'EXTENSION_LOOPBACK',
              'EXTENSION_ROLES_INCOHERENT',
              'The Extension service-worker and media roles are missing or version-mismatched.',
              'Restart Chrome after installing the coordinated Extension release and rerun the probe.',
            )
      if (coherent.length === 0) {
        return {
          chromeVersion,
          extensionVersion: extensionVersionFor(statuses),
          cdpCheck,
          extensionPolicyCheck,
          extensionLoopbackCheck,
          tabCaptureCheck,
          webRtcCheck,
        }
      }

      sessionId = `probe-${createPublicId()}`
      this.#extension.bindSession(sessionId, attached.targetId)
      const streamId = await this.#extension.prepareCapture({
        sessionId,
        targetId: attached.targetId,
        tabId: attached.tabId,
        viewerGeneration: 1,
      })
      tabCaptureCheck = PASS('TAB_CAPTURE')

      const offer = waitForMediaOffer(
        this.#extension,
        sessionId,
        configuration.requestTimeoutMilliseconds,
      )
      this.#extension.sendMediaPeerState(sessionId, true)
      this.#extension.startMedia({
        sessionId,
        viewerGeneration: 1,
        tabId: attached.tabId,
        streamId,
        capabilities: [],
        iceServers: [],
        iceTransportPolicy: 'all',
        viewport: {
          width: 640,
          height: 360,
          deviceScaleFactor: 1,
          frameRate: 30,
          revision: 1,
        },
        audio: false,
      })
      mediaStarted = true
      await offer
      webRtcCheck = PASS('WEBRTC')

      return {
        chromeVersion,
        extensionVersion: extensionVersionFor(statuses),
        cdpCheck,
        extensionPolicyCheck,
        extensionLoopbackCheck,
        tabCaptureCheck,
        webRtcCheck,
      }
    } catch (cause) {
      const code = errorCode(cause)
      if (cdpCheck.status !== 'PASS') {
        cdpCheck = failed(
          'CDP_LOOPBACK',
          'CDP_UNAVAILABLE',
          'The configured loopback CDP endpoint is unavailable.',
          'Start the managed Google Chrome Stable runtime and verify its loopback CDP endpoint.',
        )
      } else if (tabCaptureCheck.status !== 'PASS') {
        tabCaptureCheck = failed(
          'TAB_CAPTURE',
          code ?? 'TAB_CAPTURE_FAILED',
          'The Extension could not prepare unattended capture for the probe Tab.',
          'Verify the allowlisted Extension startup flag and fixed Extension policy.',
        )
      } else {
        webRtcCheck = failed(
          'WEBRTC',
          code ?? 'WEBRTC_PUBLISHER_FAILED',
          'The Extension did not create a WebRTC publisher offer for the captured Tab.',
          'Inspect the Extension media diagnostics and Chrome WebRTC support.',
        )
      }
      const statuses = this.#extension.getRuntimeStatuses()
      return {
        chromeVersion,
        extensionVersion: extensionVersionFor(statuses),
        cdpCheck,
        extensionPolicyCheck,
        extensionLoopbackCheck,
        tabCaptureCheck,
        webRtcCheck,
      }
    } finally {
      if (sessionId !== undefined && mediaStarted) {
        await this.#extension
          .stopMedia(sessionId, 'BrowShare capability probe completed')
          .catch(() => undefined)
      }
      if (sessionId !== undefined) this.#extension.releaseSession(sessionId)
      if (attached !== undefined) {
        this.#extension.releaseTarget(attached.targetId)
        await attached.controller.close().catch(() => undefined)
      }
      browser?.close()
    }
  }

  #assertRunning(): void {
    if (!this.#started || this.#closed) throw new Error('Remote Tab runtime is not running')
  }
}

export async function createEmbeddedRemoteTabRuntime(
  configuration: RuntimeOwnerConfiguration,
): Promise<EmbeddedRemoteTabRuntime | undefined> {
  if (configuration.remoteTabRuntime === undefined) return undefined
  const runtime = await EmbeddedRemoteTabRuntime.create({
    ...configuration,
    remoteTabRuntime: configuration.remoteTabRuntime,
  })
  await runtime.start()
  return runtime
}

async function loadRemoteTabPackages(): Promise<RemoteTabPackages> {
  let coreEntry: string
  let protocolEntry: string
  try {
    coreEntry = import.meta.resolve('@browshare/remote-tab-core')
    protocolEntry = import.meta.resolve('@browshare/remote-tab-protocol')
  } catch (cause) {
    throw new Error(
      'BROWSHARE_REMOTE_TAB_ENABLED requires coordinated @browshare/remote-tab-core and @browshare/remote-tab-protocol packages',
      { cause },
    )
  }
  const [core, protocol] = (await Promise.all([import(coreEntry), import(protocolEntry)])) as [
    Record<string, unknown>,
    Record<string, unknown>,
  ]
  if (
    typeof core.CdpBrowser !== 'function' ||
    typeof core.ExtensionLoopbackServer !== 'function' ||
    typeof core.RemoteTabCore !== 'function' ||
    typeof core.RemoteTabCore.prototype.closeSession !== 'function' ||
    typeof core.REMOTE_TAB_CORE_VERSION !== 'string' ||
    typeof protocol.RemoteTabError !== 'function' ||
    !Array.isArray(protocol.CAPABILITIES) ||
    !protocol.CAPABILITIES.every((value) => typeof value === 'string')
  ) {
    throw new Error('Installed Remote Tab packages do not expose the required Worker runtime API')
  }
  // Older Core releases silently ignore downloadSink and would bypass the business inbox.
  if (core.REMOTE_TAB_CORE_VERSION !== '0.1.24')
    throw new Error('Worker runtime requires coordinated Remote Tab Core 0.1.24')
  return {
    CdpBrowser: core.CdpBrowser as unknown as RemoteTabPackages['CdpBrowser'],
    ExtensionLoopbackServer:
      core.ExtensionLoopbackServer as RemoteTabPackages['ExtensionLoopbackServer'],
    RemoteTabCore: core.RemoteTabCore as RemoteTabPackages['RemoteTabCore'],
    RemoteTabError: protocol.RemoteTabError as RemoteTabPackages['RemoteTabError'],
    coreVersion: core.REMOTE_TAB_CORE_VERSION,
    capabilities: protocol.CAPABILITIES as string[],
  }
}

async function waitForMediaOffer(
  extension: ExtensionLoopbackPort,
  sessionId: string,
  timeoutMilliseconds: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (cause?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      if (cause === undefined) resolve()
      else reject(cause)
    }
    const unsubscribe = extension.onMediaSignal((signal) => {
      if (signal.sessionId !== sessionId) return
      if (signal.type === 'description') finish()
      else if (signal.type === 'start-failed') {
        const code = signal.error?.code ?? 'WEBRTC_PUBLISHER_FAILED'
        const error = new Error('Remote Tab Extension media publisher failed')
        Object.assign(error, { code })
        finish(error)
      }
    })
    const timer = setTimeout(
      () =>
        finish(
          Object.assign(new Error('Remote Tab WebRTC offer timed out'), {
            code: 'WEBRTC_OFFER_TIMEOUT',
          }),
        ),
      timeoutMilliseconds,
    )
    timer.unref()
  })
}

async function probeLoopbackAdapter(): Promise<WorkerProbeCheck> {
  const adapter = new ProfileProxyAdapter({ type: 'DIRECT' })
  try {
    await adapter.start()
    return PASS('PROXY_ADAPTER')
  } catch {
    return failed(
      'PROXY_ADAPTER',
      'PROXY_ADAPTER_BIND_FAILED',
      'The Worker could not bind a loopback Proxy Adapter listener.',
      'Verify local port permissions and Worker network namespace configuration.',
    )
  } finally {
    await adapter.close()
  }
}

function extensionVersionFor(statuses: readonly ExtensionRuntimeStatus[]): string | null {
  const versions = new Set<string>()
  for (const status of statuses) {
    if (status.serviceWorkerVersion !== undefined) versions.add(status.serviceWorkerVersion)
    if (status.mediaVersion !== undefined) versions.add(status.mediaVersion)
  }
  return versions.size === 1 ? [...versions][0]! : null
}

function chromeVersionFromProduct(product: string): string | null {
  return /^(?:Chrome|HeadlessChrome)\/([0-9]+(?:\.[0-9]+){3})$/u.exec(product)?.[1] ?? null
}

function failed(
  name: WorkerProbeCheck['name'],
  code: string,
  summary: string,
  guidance: string,
): WorkerProbeCheck {
  return { name, status: 'FAIL', code, summary, guidance }
}

function notRun(name: WorkerProbeCheck['name'], summary: string): WorkerProbeCheck {
  return {
    name,
    status: 'NOT_RUN',
    code: 'DEPENDENCY_PROBE_FAILED',
    summary,
    guidance: 'Resolve the preceding runtime check and rerun the Worker capability probe.',
  }
}

function errorCode(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined
  return typeof cause.code === 'string' && cause.code.length > 0 ? cause.code : undefined
}

function assertLoopbackCdpEndpoint(value: string): void {
  const url = new URL(value)
  if (
    url.protocol !== 'ws:' ||
    url.hostname !== '127.0.0.1' ||
    url.port === '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    !/^\/cdp\/[a-f0-9]{64}$/u.test(url.pathname)
  ) {
    throw new TypeError('Remote Tab CDP endpoint must be an owned loopback pipe bridge')
  }
}
