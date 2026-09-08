import type { StorageProtection } from './storage-protection.js'
import { cleanupError } from './cleanup-error.js'
import { WorkerMediaMetrics, type MediaDiagnostic } from './media-metrics.js'
import { isDeepStrictEqual } from 'node:util'

import { isPublicId } from '@browshare/common'
import {
  SessionPolicyValuesSchema,
  ProfileQualityPolicySchema,
  SessionTransferSettingsSchema,
  type SessionTransferSettings,
  type StoragePolicy,
  type ProfileStoragePolicy,
  type ProfileQualityPolicy,
  type SessionPolicyValues,
  type SessionPageScriptContext,
  type WorkerSessionClosedFact,
  type WorkerSessionRuntimeFact,
  type WorkerPageScriptError,
} from '@browshare/contracts'
import { Value } from 'typebox/value'

import { WorkerSessionStorage, type SessionStorageErrorFactory } from './session-storage.js'
import { SessionRecycling } from './session-recycling.js'
import type { WorkerRetainedDownloads } from './retained-downloads.js'

export interface SessionViewerTicketRequest {
  sessionId: string
  viewerGeneration: number
  gatewayId: string
  capabilities: readonly string[]
  expiresInSeconds: number
}

export interface SessionViewerTicket {
  token: string
  claims: {
    sessionId: string
    viewerGeneration: number
    gatewayId: string
    capabilities: readonly string[]
    issuedAt: number
    expiresAt: number
    jti: string
    issuer: string
    audience: string
  }
}

export interface SessionNavigationRequest {
  sessionId: string
  action: 'go' | 'back' | 'forward' | 'reload' | 'local-open'
  url?: string
  source?: 'viewer' | 'document'
  currentUrl?: string
  method?: string
  isRedirect?: boolean
}

export interface SessionNavigationDecision {
  allowed: boolean
  url?: string
  reason?: string
  confirmation?: { title: string; body: string; confirmLabel: string }
}

export interface CreateWorkerTabSession {
  workerStoragePolicy?: StoragePolicy
  profileStoragePolicy?: ProfileStoragePolicy
  kind?: 'NORMAL' | 'MAINTENANCE'
  messageId: string
  sessionId: string
  profileId: string
  runtimeId: string
  profileGeneration: number
  reservationExpiresAt: string
  leaseExpiresAt: string
  createdAt: string
  policy: SessionPolicyValues
  qualityPolicy: ProfileQualityPolicy
  transferSettings: SessionTransferSettings
  initialUrl: string
  capabilities: readonly string[]
  signaling: { gatewayId: string; endpoint: string; bindingToken: string }
  pageScript?: { versionId: string; source: string; context?: SessionPageScriptContext }
}

export interface WorkerTabSessionAuthorization {
  authorizeNavigation(request: SessionNavigationRequest): Promise<SessionNavigationDecision>
  issueViewerTicket(request: SessionViewerTicketRequest): Promise<SessionViewerTicket>
}

export interface WorkerSessionCloseOptions {
  browserClosed?: boolean
}

export interface RemoteTabSessionPort {
  getAttachment(): { tabId: number; targetId: string }
  sampleFrameChange(): Promise<{ changed: boolean; observedAt: number }>
  createViewerTicket(
    request: Omit<SessionViewerTicketRequest, 'sessionId'>,
  ): Promise<SessionViewerTicket>
  close(reason: string, options?: WorkerSessionCloseOptions): Promise<void>
}

/** Required public Core surface. Packages are supplied by the coordinated Worker image. */
export interface SessionCorePort {
  closeSession(
    sessionId: string,
    reason: string,
    options?: WorkerSessionCloseOptions,
  ): Promise<void>
  attachSession(input: {
    sessionId: string
    cdpEndpoint: string
    tab: { mode: 'create'; initialUrl: string; deferUntilViewer: true }
    capabilities: readonly string[]
    mediaLimits: {
      maxWidth: number
      maxHeight: number
      maxFrameRate: number
      maxBitrate: number | null
    }
    signaling: CreateWorkerTabSession['signaling']
    storage: WorkerSessionStorage
    downloadSink: ReturnType<WorkerRetainedDownloads['sink']>
    fileTransferLimits: {
      maxFileBytes: number
      maxBatchBytes: number
      maxTemporaryBytes: number
      maxFiles: number
      allowedExtensions: string[]
    }
    childTargetPolicy: 'close-and-local-open' | 'retain'
    pageScript?: { source: string; context?: SessionPageScriptContext }
    hooks: {
      authorizeNavigation(request: SessionNavigationRequest): Promise<SessionNavigationDecision>
      onStateChanged(event: { current: string; reason?: string }): void
      onInput(event: { sessionId: string; observedAt: number }): void
      onTitleChanged(event: { sessionId: string; title: string }): void
      onDiagnostic(event: MediaDiagnostic & { occurredAt: number }): void
    }
    ticketIssuer: Pick<WorkerTabSessionAuthorization, 'issueViewerTicket'>
  }): Promise<RemoteTabSessionPort>
}

interface SessionEntry {
  readonly request: CreateWorkerTabSession
  readonly storage: WorkerSessionStorage
  readonly creation: Promise<WorkerSessionRuntimeFact>
  readonly cancel: AbortController
  fact: WorkerSessionRuntimeFact
  core?: RemoteTabSessionPort
  closing: boolean
  browserClosed?: boolean
  close?: Promise<void>
  leaseTimer?: NodeJS.Timeout
  frameTimer?: NodeJS.Timeout
  proxyTimer?: NodeJS.Timeout
  recycleTimer?: NodeJS.Timeout
  recycling?: SessionRecycling
  ticketQueue: Promise<void>
  providedTicket?: SessionViewerTicket
}

export class WorkerSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'WorkerSessionError'
  }
}

export interface WorkerTabSessionOwner {
  checkProxyHealth(profileId: string): Promise<boolean>
  resolveProfile(request: CreateWorkerTabSession): Promise<string>
  publish(fact: WorkerSessionRuntimeFact): void
  remove(sessionId: string): void
  closed(fact: WorkerSessionClosedFact): void
  onCleanupError(sessionId: string, cause: unknown): void
  onPageScriptError?(sessionId: string, error: WorkerPageScriptError): void
}

/** Business ownership and leases around the shared Remote Tab Core. No media implementation. */
export class WorkerTabSessions {
  readonly #mediaMetrics = new WorkerMediaMetrics()
  readonly #entries = new Map<string, SessionEntry>()
  readonly #commands = new Map<string, { sessionId: string; expiresAt: number }>()
  readonly #retired = new Map<string, number>()
  #closed = false

  constructor(
    readonly core: SessionCorePort,
    readonly storageRoot: string,
    readonly owner: WorkerTabSessionOwner,
    readonly retainedDownloads: WorkerRetainedDownloads,
    readonly storageError?: SessionStorageErrorFactory,
    readonly storageProtection?: StorageProtection,
  ) {}

  readMediaMetrics(): string[] {
    return this.#mediaMetrics.render()
  }

  create(
    request: CreateWorkerTabSession,
    authorization: WorkerTabSessionAuthorization,
  ): Promise<WorkerSessionRuntimeFact> {
    if (this.#closed)
      throw new WorkerSessionError('WORKER_CLOSED', 'Worker Session manager is closed')
    validateRequest(request)
    request = { ...request, kind: request.kind ?? 'NORMAL' }
    this.#pruneCommands()
    const current = this.#entries.get(request.sessionId)
    const command = this.#commands.get(request.messageId)
    if (command !== undefined && command.sessionId !== request.sessionId)
      throw new WorkerSessionError('COMMAND_ID_CONFLICT', 'Command ID belongs to another Session')
    if (current !== undefined) {
      if (!isDeepStrictEqual(current.request, request))
        throw new WorkerSessionError(
          'SESSION_ID_CONFLICT',
          'Session creation identity or configuration changed',
        )
      if (current.closing) throw new WorkerSessionError('SESSION_CLOSED', 'Session is closing')
      return current.creation
    }
    if (this.#retired.has(request.sessionId) || command !== undefined)
      throw new WorkerSessionError('SESSION_CLOSED', 'Session creation command is already retired')
    // A closing Session still owns its tabs and storage until cleanup succeeds. Idempotent
    // retries above refer to that same owner; new requests must not cross this boundary.
    for (const entry of this.#entries.values()) {
      if (
        entry.request.profileId === request.profileId &&
        (request.kind === 'MAINTENANCE' || entry.request.kind === 'MAINTENANCE')
      )
        throw new WorkerSessionError(
          'PROFILE_SESSION_CONFLICT',
          'Maintenance requires exclusive ownership of the Profile',
        )
    }
    assertNotExpired(request.reservationExpiresAt, 'RESERVATION_EXPIRED')
    assertLease(request.leaseExpiresAt)
    const deferred = Promise.withResolvers<WorkerSessionRuntimeFact>()
    const entry: SessionEntry = {
      request: structuredClone(request),
      storage: new WorkerSessionStorage(
        this.storageRoot,
        request.sessionId,
        request.transferSettings.maxTemporaryBytes,
        this.storageError,
        () => this.retainedDownloads.reservedBytes(request.sessionId),
        this.storageProtection
          ? { storage: this.storageProtection, profileId: request.profileId }
          : undefined,
      ),
      fact: {
        sessionId: request.sessionId,
        profileId: request.profileId,
        runtimeId: request.runtimeId,
        profileGeneration: request.profileGeneration,
        status: 'CREATING',
        tabId: null,
        targetId: null,
        viewerGeneration: 0,
        leaseExpiresAt: request.leaseExpiresAt,
        remoteTitle: null,
      },
      creation: deferred.promise,
      cancel: new AbortController(),
      closing: false,
      ticketQueue: Promise.resolve(),
    }
    this.#entries.set(request.sessionId, entry)
    this.#commands.set(request.messageId, {
      sessionId: request.sessionId,
      expiresAt: Date.parse(request.reservationExpiresAt),
    })
    this.#scheduleLease(entry)
    void this.#attach(entry, authorization).then(deferred.resolve, deferred.reject)
    return deferred.promise
  }

  async #attach(
    entry: SessionEntry,
    authorization: WorkerTabSessionAuthorization,
  ): Promise<WorkerSessionRuntimeFact> {
    const request = entry.request
    try {
      this.owner.publish({ ...entry.fact })
      const endpoint = await this.#waitAuthorized(entry, this.owner.resolveProfile(request), true)
      this.#assertLive(entry)
      assertNotExpired(request.reservationExpiresAt, 'RESERVATION_EXPIRED')
      // Initial navigation must pass the same owning policy as later Viewer navigation.
      const decision = await this.#waitAuthorized(
        entry,
        authorization.authorizeNavigation({
          sessionId: request.sessionId,
          action: 'go',
          url: request.initialUrl,
        }),
        true,
      )
      if (!decision.allowed)
        throw new WorkerSessionError('NAVIGATION_DENIED', 'Session start URL is not allowed')
      this.#assertLive(entry)
      assertNotExpired(request.reservationExpiresAt, 'RESERVATION_EXPIRED')
      entry.core = await this.core.attachSession({
        sessionId: request.sessionId,
        cdpEndpoint: endpoint,
        tab: {
          mode: 'create',
          initialUrl: decision.url ?? request.initialUrl,
          deferUntilViewer: true,
        },
        capabilities: request.capabilities,
        mediaLimits: {
          maxWidth: request.qualityPolicy.maxWidth,
          maxHeight: request.qualityPolicy.maxHeight,
          maxFrameRate: request.qualityPolicy.maxFps,
          maxBitrate:
            request.qualityPolicy.maxBitrateKbps === null
              ? null
              : request.qualityPolicy.maxBitrateKbps * 1000,
        },
        signaling: request.signaling,
        storage: entry.storage,
        downloadSink: this.retainedDownloads.sink(
          request.sessionId,
          request.transferSettings.maxTemporaryBytes,
          () => entry.storage.reservedBytes,
          request.profileId,
        ),
        fileTransferLimits: {
          maxFileBytes: request.transferSettings.maxFileBytes,
          maxBatchBytes: request.transferSettings.maxTemporaryBytes,
          maxTemporaryBytes: request.transferSettings.maxTemporaryBytes,
          maxFiles: request.transferSettings.maxFiles,
          allowedExtensions: request.transferSettings.allowedExtensions,
        },
        childTargetPolicy: request.kind === 'MAINTENANCE' ? 'retain' : 'close-and-local-open',
        ...(request.pageScript === undefined
          ? {}
          : {
              pageScript: {
                source: request.pageScript.source,
                ...(request.pageScript.context === undefined
                  ? {}
                  : { context: request.pageScript.context }),
              },
            }),
        hooks: {
          authorizeNavigation: (navigation) => authorization.authorizeNavigation(navigation),
          onStateChanged: (event) => this.#onState(entry, event),
          onDiagnostic: (event) => {
            if (this.#entries.get(request.sessionId) !== entry) return
            if (
              event.name === 'page-script.error' &&
              entry.request.pageScript !== undefined &&
              entry.fact.pageScriptError === undefined
            ) {
              // This is a first-failure summary, not a stream of page-controlled text.
              const error: WorkerPageScriptError = {
                code: 'PAGE_SCRIPT_FAILED',
                versionId: entry.request.pageScript.versionId,
                occurredAt: new Date(event.occurredAt).toISOString(),
              }
              this.#publish(entry, { pageScriptError: error })
              this.owner.onPageScriptError?.(request.sessionId, error)
            }
            if (!entry.closing) this.#mediaMetrics.observe(request.sessionId, event)
          },
          onInput: ({ observedAt }) => {
            if (entry.closing || entry.recycling === undefined) return
            entry.recycling.input(observedAt)
            this.#publish(entry, { lastInputAt: new Date(observedAt).toISOString() })
            this.#scheduleRecycling(entry)
          },
          onTitleChanged: ({ title }) => {
            if (entry.closing) return
            const remoteTitle = [...title.trim()].slice(0, 4_096).join('') || null
            if (remoteTitle !== entry.fact.remoteTitle) this.#publish(entry, { remoteTitle })
          },
        },
        ticketIssuer: {
          issueViewerTicket: (ticket) =>
            this.#waitAuthorized(
              entry,
              entry.providedTicket === undefined
                ? authorization.issueViewerTicket(ticket)
                : Promise.resolve(entry.providedTicket),
            ),
        },
      })
      this.#assertLive(entry)
      assertNotExpired(request.reservationExpiresAt, 'RESERVATION_EXPIRED')
      this.#publish(entry, { ...entry.core.getAttachment(), status: 'READY' })
      entry.recycling = new SessionRecycling(
        request.policy,
        Date.parse(request.createdAt),
        Date.now(),
      )
      this.#scheduleRecycling(entry)
      if (!request.policy.recycleDisabled) {
        if (request.policy.noFrameChangeTimeoutSeconds !== null) this.#pollFrames(entry)
        if (request.policy.proxyFailureTimeoutSeconds !== null) this.#pollProxy(entry)
      }
      return { ...entry.fact }
    } catch (cause) {
      entry.closing = true
      clearTimeout(entry.leaseTimer)
      try {
        await this.#cleanup(entry, 'Session creation failed')
      } catch (cleanupCause) {
        // Keep ownership visible so reconciliation can retry real cleanup failures.
        this.owner.onCleanupError(request.sessionId, cleanupCause)
      }
      throw cause
    }
  }

  createViewerTicket(
    sessionId: string,
    request: Omit<SessionViewerTicketRequest, 'sessionId'>,
    providedTicket?: SessionViewerTicket,
  ): Promise<SessionViewerTicket> {
    const entry = this.#require(sessionId)
    const operation = entry.ticketQueue.then(async () => {
      await entry.creation
      this.#assertLive(entry)
      if (request.expiresInSeconds !== 60)
        throw new WorkerSessionError(
          'VIEWER_TICKET_INVALID',
          'Viewer tickets must expire in 60 seconds',
        )
      if (request.viewerGeneration <= entry.fact.viewerGeneration)
        throw new WorkerSessionError('VIEWER_GENERATION_STALE', 'Viewer generation must increase')
      if (providedTicket !== undefined) {
        const claims = providedTicket.claims
        if (
          claims.sessionId !== sessionId ||
          claims.viewerGeneration !== request.viewerGeneration ||
          claims.gatewayId !== request.gatewayId ||
          claims.expiresAt * 1000 <= Date.now() ||
          claims.expiresAt - claims.issuedAt !== 60 ||
          !isDeepStrictEqual(claims.capabilities, request.capabilities)
        )
          throw new WorkerSessionError(
            'VIEWER_TICKET_INVALID',
            'The supplied Viewer Ticket does not match this request',
          )
        entry.providedTicket = providedTicket
      }
      try {
        const ticket = await entry.core!.createViewerTicket(request)
        this.#assertLive(entry)
        this.#publish(entry, { viewerGeneration: request.viewerGeneration })
        return ticket
      } finally {
        delete entry.providedTicket
      }
    })
    entry.ticketQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  continueSession(sessionId: string, viewerGeneration: number): WorkerSessionRuntimeFact {
    const entry = this.#require(sessionId)
    this.#assertLive(entry)
    if (
      viewerGeneration !== entry.fact.viewerGeneration ||
      !['CONNECTED', 'SUSPENDED'].includes(entry.fact.status)
    )
      throw new WorkerSessionError(
        'VIEWER_GENERATION_STALE',
        'Continue requires the connected Viewer generation',
      )
    const next = entry.recycling?.next()
    const now = Date.now()
    if (!next || !next.canContinue || Date.parse(next.deadline) <= now)
      throw new WorkerSessionError(
        'SESSION_CANNOT_CONTINUE',
        'This policy condition cannot be extended',
      )
    entry.recycling!.continue(now)
    this.#scheduleRecycling(entry)
    return { ...entry.fact }
  }

  renewLease(sessionId: string, leaseExpiresAt: string): WorkerSessionRuntimeFact {
    const entry = this.#require(sessionId)
    this.#assertLive(entry)
    assertLease(leaseExpiresAt)
    if (Date.parse(leaseExpiresAt) > Date.parse(entry.fact.leaseExpiresAt!)) {
      this.#publish(entry, { leaseExpiresAt })
      this.#scheduleLease(entry)
    }
    return { ...entry.fact }
  }

  closeSession(
    sessionId: string,
    reason: string,
    creationExpiresAt?: string,
    options?: WorkerSessionCloseOptions,
  ): Promise<void> {
    if (creationExpiresAt !== undefined) {
      const expiresAt = Date.parse(creationExpiresAt)
      if (!Number.isFinite(expiresAt))
        throw new WorkerSessionError('INVALID_EXPIRY', 'Session creation expiry is invalid')
      this.#pruneCommands()
      // A close may overtake creation on the control channel.
      this.#retired.set(sessionId, Math.max(this.#retired.get(sessionId) ?? 0, expiresAt))
    }
    const entry = this.#entries.get(sessionId)
    if (entry === undefined) return Promise.resolve()
    if (options?.browserClosed) entry.browserClosed = true
    if (entry.close !== undefined)
      return options?.browserClosed
        ? entry.close.catch(() => this.closeSession(sessionId, reason, undefined, options))
        : entry.close
    entry.closing = true
    clearTimeout(entry.frameTimer)
    clearTimeout(entry.proxyTimer)
    clearTimeout(entry.recycleTimer)
    entry.cancel.abort()
    clearTimeout(entry.leaseTimer)
    this.#publish(entry, { status: 'CLOSING' })
    // Publish close intent before awaiting an in-flight attachment or ticket request.
    entry.close = Promise.resolve()
      .then(async () => {
        await entry.creation.catch(() => undefined)
        await entry.ticketQueue
        await this.#cleanup(entry, reason)
      })
      .catch((cause: unknown) => {
        delete entry.close
        this.#publish(entry, { cleanupError: cleanupError(cause) })
        throw cause
      })
    return entry.close
  }

  async close(): Promise<void> {
    this.#closed = true
    const results = await Promise.allSettled(
      [...this.#entries.keys()].map((id) => this.closeSession(id, 'WORKER_SHUTDOWN')),
    )
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }

  async #cleanup(entry: SessionEntry, reason: string): Promise<void> {
    if (this.#entries.get(entry.request.sessionId) !== entry) return
    await this.core.closeSession(entry.request.sessionId, reason, {
      browserClosed: entry.browserClosed === true,
    })
    // Closing Core waits for completed download handoffs before the retention deadline is capped.
    await this.retainedDownloads.endSession(entry.request.sessionId)
    // Worker also owns failed upload-open cleanup, including cases before a Core handle exists.
    await entry.storage.cleanupSession(entry.request.sessionId)
    clearTimeout(entry.leaseTimer)
    clearTimeout(entry.frameTimer)
    clearTimeout(entry.proxyTimer)
    clearTimeout(entry.recycleTimer)
    if (entry.fact.tabId !== null || entry.fact.pageScriptError !== undefined)
      this.owner.closed({
        sessionId: entry.fact.sessionId,
        profileId: entry.fact.profileId,
        runtimeId: entry.fact.runtimeId,
        profileGeneration: entry.fact.profileGeneration,
        tabId: entry.fact.tabId,
        targetId: entry.fact.targetId,
        closedAt: new Date().toISOString(),
        reason,
        ...(entry.fact.pageScriptError === undefined
          ? {}
          : { pageScriptError: entry.fact.pageScriptError }),
      })
    this.#entries.delete(entry.request.sessionId)
    this.#mediaMetrics.remove(entry.request.sessionId)
    this.#retired.set(entry.request.sessionId, Date.parse(entry.request.reservationExpiresAt))
    this.owner.remove(entry.request.sessionId)
  }

  #onState(entry: SessionEntry, event: { current: string; reason?: string }): void {
    if (event.current === 'FAILED' || event.current === 'CLOSED') {
      void this.closeSession(entry.request.sessionId, `REMOTE_TAB_${event.current}`).catch(
        (cause: unknown) => this.owner.onCleanupError(entry.request.sessionId, cause),
      )
      return
    }
    if (entry.closing) return
    const statuses: Record<string, WorkerSessionRuntimeFact['status']> = {
      READY: 'READY',
      CONNECTED: 'CONNECTED',
      SUSPENDED: 'SUSPENDED',
      RECONNECTING: 'DISCONNECTED',
      CLOSING: 'CLOSING',
    }
    const status = statuses[event.current]
    // READY is emitted during attachment, before Core returns the tab identity.
    if (status !== undefined && entry.core !== undefined) {
      this.#publish(entry, { status })
      if (status === 'CONNECTED' || status === 'SUSPENDED' || status === 'DISCONNECTED') {
        entry.recycling?.viewerConnected(status !== 'DISCONNECTED', Date.now())
        this.#scheduleRecycling(entry)
      }
    }
  }

  #scheduleRecycling(entry: SessionEntry): void {
    clearTimeout(entry.recycleTimer)
    if (entry.closing || entry.recycling === undefined) return
    const recycling = entry.recycling.next()
    this.#publish(entry, { recycling })
    if (recycling === null) return
    const remaining = Date.parse(recycling.deadline) - Date.now()
    entry.recycleTimer = setTimeout(
      () => {
        void this.#enforceRecycling(entry).catch((cause: unknown) =>
          this.owner.onCleanupError(entry.request.sessionId, cause),
        )
      },
      Math.max(0, Math.min(remaining, 2_147_483_647)),
    )
    entry.recycleTimer.unref()
  }

  async #enforceRecycling(entry: SessionEntry): Promise<void> {
    if (entry.closing) return
    const pending = entry.recycling?.next()
    if (pending?.reason === 'NO_FRAME_CHANGE' && Date.parse(pending.deadline) <= Date.now()) {
      // Observe the current frame before deciding: a periodic sample can be one tick behind.
      if (!(await this.#sampleFrame(entry))) return
    }
    if (entry.closing) return
    const current = entry.recycling?.next()
    if (current && Date.parse(current.deadline) <= Date.now())
      await this.closeSession(entry.request.sessionId, `POLICY_${current.reason}`)
    else this.#scheduleRecycling(entry)
  }

  async #sampleFrame(entry: SessionEntry): Promise<boolean> {
    try {
      const sample = await entry.core!.sampleFrameChange()
      if (entry.closing) return false
      if (sample.changed) {
        entry.recycling!.frameChanged(sample.observedAt)
        this.#publish(entry, { lastFrameChangedAt: new Date(sample.observedAt).toISOString() })
        this.#scheduleRecycling(entry)
      }
      return true
    } catch (cause) {
      if (entry.closing) return false
      this.owner.onCleanupError(entry.request.sessionId, cause)
      await this.closeSession(entry.request.sessionId, 'FRAME_OBSERVATION_FAILED')
      return false
    }
  }

  #pollFrames(entry: SessionEntry): void {
    void this.#sampleFrame(entry)
      .then((active) => {
        if (!active || entry.closing) return
        entry.frameTimer = setTimeout(() => this.#pollFrames(entry), 1_000)
        entry.frameTimer.unref()
      })
      .catch((cause: unknown) => this.owner.onCleanupError(entry.request.sessionId, cause))
  }

  #pollProxy(entry: SessionEntry): void {
    void this.owner
      .checkProxyHealth(entry.request.profileId)
      .then((healthy) => {
        if (entry.closing) return
        entry.recycling!.proxyHealthy(healthy, Date.now())
        this.#scheduleRecycling(entry)
        entry.proxyTimer = setTimeout(() => this.#pollProxy(entry), 5_000)
        entry.proxyTimer.unref()
      })
      .catch(async (cause: unknown) => {
        if (entry.closing) return
        this.owner.onCleanupError(entry.request.sessionId, cause)
        await this.closeSession(entry.request.sessionId, 'PROXY_OBSERVATION_FAILED')
      })
      .catch((cause: unknown) => this.owner.onCleanupError(entry.request.sessionId, cause))
  }

  #publish(entry: SessionEntry, values: Partial<WorkerSessionRuntimeFact>): void {
    if (
      (values.status !== undefined &&
        values.status !== entry.fact.status &&
        !['CONNECTED', 'SUSPENDED'].includes(values.status)) ||
      (values.viewerGeneration !== undefined &&
        values.viewerGeneration !== entry.fact.viewerGeneration)
    )
      this.#mediaMetrics.remove(entry.request.sessionId)
    entry.fact = { ...entry.fact, ...values }
    this.owner.publish({ ...entry.fact })
  }

  #scheduleLease(entry: SessionEntry): void {
    clearTimeout(entry.leaseTimer)
    entry.leaseTimer = setTimeout(
      () => {
        void this.closeSession(entry.request.sessionId, 'SESSION_LEASE_EXPIRED').catch(
          (cause: unknown) => this.owner.onCleanupError(entry.request.sessionId, cause),
        )
      },
      Math.max(0, Date.parse(entry.fact.leaseExpiresAt!) - Date.now()),
    )
    entry.leaseTimer.unref()
  }

  async #waitAuthorized<T>(
    entry: SessionEntry,
    operation: Promise<T>,
    reservation = false,
  ): Promise<T> {
    const signal = entry.cancel.signal
    let onAbort: () => void = () => undefined
    let timer: NodeJS.Timeout | undefined
    const cancellation = new Promise<never>((_, reject) => {
      onAbort = () =>
        reject(new WorkerSessionError('SESSION_CLOSED', 'Session authorization was cancelled'))
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      const deadline = Math.min(
        Date.parse(entry.fact.leaseExpiresAt!),
        reservation ? Date.parse(entry.request.reservationExpiresAt) : Infinity,
      )
      timer = setTimeout(
        () =>
          reject(
            new WorkerSessionError(
              reservation ? 'RESERVATION_EXPIRED' : 'SESSION_LEASE_EXPIRED',
              'Session authorization expired while waiting',
            ),
          ),
        Math.max(0, deadline - Date.now()),
      )
      timer.unref()
    })
    try {
      return await Promise.race([operation, cancellation])
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  }

  #assertLive(entry: SessionEntry): void {
    if (entry.closing || this.#closed)
      throw new WorkerSessionError('SESSION_CLOSED', 'Session is closing')
    assertNotExpired(entry.fact.leaseExpiresAt!, 'SESSION_LEASE_EXPIRED')
  }

  #require(sessionId: string): SessionEntry {
    const entry = this.#entries.get(sessionId)
    if (entry === undefined)
      throw new WorkerSessionError('SESSION_NOT_FOUND', 'Worker Session does not exist')
    return entry
  }

  #pruneCommands(): void {
    const now = Date.now()
    for (const [id, item] of this.#commands)
      if (item.expiresAt <= now && !this.#entries.has(item.sessionId)) this.#commands.delete(id)
    for (const [id, expiry] of this.#retired) if (expiry <= now) this.#retired.delete(id)
  }
}

function validateRequest(request: CreateWorkerTabSession): void {
  if (
    !Value.Check(SessionTransferSettingsSchema, request.transferSettings) ||
    request.transferSettings.maxFileBytes > request.transferSettings.maxTemporaryBytes
  )
    throw new TypeError('Session creation requires a valid transfer policy snapshot')
  if (!Value.Check(ProfileQualityPolicySchema, request.qualityPolicy))
    throw new TypeError('Session creation requires a valid media policy snapshot')
  if (request.kind !== undefined && request.kind !== 'NORMAL' && request.kind !== 'MAINTENANCE')
    throw new TypeError('Session kind must be NORMAL or MAINTENANCE')
  if (
    ![request.messageId, request.sessionId, request.profileId, request.runtimeId].every(isPublicId)
  )
    throw new TypeError('Worker Session identities must be UUIDv7')
  if (request.pageScript !== undefined && !isPublicId(request.pageScript.versionId))
    throw new TypeError('Page Script version identity must be UUIDv7')
  if (!Number.isSafeInteger(request.profileGeneration) || request.profileGeneration < 1)
    throw new TypeError('Profile generation must be a positive integer')
  if (!Number.isFinite(Date.parse(request.reservationExpiresAt)))
    throw new TypeError('Invalid reservation expiry')
  if (
    !Number.isFinite(Date.parse(request.createdAt)) ||
    !Value.Check(SessionPolicyValuesSchema, request.policy)
  )
    throw new TypeError('Session creation requires a valid creation time and policy snapshot')
}

function assertNotExpired(value: string, code: string): void {
  if (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now())
    throw new WorkerSessionError(code, 'Session authorization has expired')
}

function assertLease(value: string): void {
  assertNotExpired(value, 'SESSION_LEASE_EXPIRED')
  if (Date.parse(value) > Date.now() + 10 * 60 * 1000)
    throw new WorkerSessionError('SESSION_LEASE_INVALID', 'Session lease exceeds ten minutes')
}
