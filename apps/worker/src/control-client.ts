import { hostname } from 'node:os'
import { isDeepStrictEqual } from 'node:util'

import { createPublicId, type createServiceLogger } from '@browshare/common'
import {
  BROWSHARE_VERSION,
  decodeWorkerControlMessage,
  encodeWorkerControlMessage,
  isWorkerRecoveryCommand,
  WORKER_CONTROL_MAX_MESSAGE_BYTES,
  WORKER_CONTROL_PROTOCOL_MAJOR,
  WORKER_CONTROL_PROTOCOL_MINOR,
  type WorkerCapabilitiesAcceptedMessage,
  type WorkerCapabilitiesMessage,
  type WorkerCommandAcceptedMessage,
  type WorkerControlErrorCode,
  type WorkerControlErrorMessage,
  type WorkerDiagnosticProbeCommandMessage,
  type WorkerProxyProbeCommandMessage,
  type WorkerStoragePolicyCommandMessage,
  type WorkerStoragePolicyResultMessage,
  type WorkerProxyProbeResultMessage,
  type WorkerDiagnosticProbeResultMessage,
  type WorkerProfileRuntimeCommandMessage,
  type WorkerProfileRuntimeResultMessage,
  type WorkerSessionCloseCommandMessage,
  type WorkerSessionCloseResultMessage,
  type WorkerSessionCreateCommandMessage,
  type WorkerSessionCreateResultMessage,
  type WorkerSessionContinueCommandMessage,
  type WorkerSessionContinueResultMessage,
  type WorkerSessionViewerCommandMessage,
  type WorkerSessionViewerResultMessage,
  type WorkerHeartbeatAcknowledgedMessage,
  type WorkerHeartbeatMessage,
  type WorkerRuntimeMetrics,
  type WorkerHelloAcceptedMessage,
  type WorkerHelloMessage,
  type WorkerSnapshotAcceptedMessage,
  type WorkerSnapshotMessage,
} from '@browshare/contracts'
import WebSocket, { type RawData } from 'ws'

import type { WorkerConfiguration } from './configuration.js'
import type { StoredWorkerIdentity } from './identity.js'
import type { WorkerRuntimeMonitor } from './runtime-monitor.js'
import {
  ProfileRuntimeCommands,
  type ProfileRuntimeCommandPort,
} from './profile-runtime-commands.js'
import { ProfileChromeError } from './profile-chrome.js'
import { StorageProtectionError } from './storage-protection.js'
import { ProfileProxyAdapter, type ProxyExitIpResult } from './proxy-adapter.js'
import {
  executeSessionClose,
  executeSessionCreate,
  executeSessionContinue,
  executeSessionViewer,
  type SessionCommandPort,
} from './session-commands.js'
import { WorkerSessionError } from './tab-sessions.js'
import { WorkerDownloadReporter } from './download-control.js'
import { WorkerDownloadAuthorizer } from './download-authorization.js'
import { WorkerDownloadServer } from './download-server.js'
import type { WorkerRetainedDownloads } from './retained-downloads.js'

type ServiceLogger = ReturnType<typeof createServiceLogger>
export type WorkerControlState =
  'idle' | 'connecting' | 'reconciling' | 'connected' | 'reconnecting' | 'closed'

type WorkerCommand =
  | WorkerDiagnosticProbeCommandMessage
  | WorkerProxyProbeCommandMessage
  | WorkerStoragePolicyCommandMessage
  | WorkerProfileRuntimeCommandMessage
  | WorkerSessionCloseCommandMessage
  | WorkerSessionCreateCommandMessage
  | WorkerSessionContinueCommandMessage
  | WorkerSessionViewerCommandMessage
type WorkerCommandResult =
  | WorkerDiagnosticProbeResultMessage
  | WorkerProxyProbeResultMessage
  | WorkerStoragePolicyResultMessage
  | WorkerControlErrorMessage
  | WorkerProfileRuntimeResultMessage
  | WorkerSessionCloseResultMessage
  | WorkerSessionCreateResultMessage
  | WorkerSessionContinueResultMessage
  | WorkerSessionViewerResultMessage

interface CachedWorkerCommand {
  readonly command: WorkerCommand
  readonly acknowledgement: WorkerCommandAcceptedMessage
  result?: WorkerCommandResult
  completedAt?: number
}

const COMMAND_CACHE_LIMIT = 256
const COMMAND_CACHE_TTL_MILLISECONDS = 60 * 60 * 1_000
const MAX_RECONCILIATION_ROUNDS = 8

export class WorkerControlClient {
  readonly #configuration: WorkerConfiguration
  readonly #identity: StoredWorkerIdentity
  readonly #logger: ServiceLogger
  readonly #runtimeMonitor: WorkerRuntimeMonitor
  readonly #instanceId = createPublicId()
  #state: WorkerControlState = 'idle'
  #socket: WebSocket | undefined
  #reconnectTimer: NodeJS.Timeout | undefined
  #reconnectDelayMilliseconds: number
  #heartbeatTimer: NodeJS.Timeout | undefined
  #pendingHeartbeat:
    { readonly messageId: string; readonly sequence: number; readonly sentAt: number } | undefined
  #latestMetrics: { metrics: WorkerRuntimeMetrics; observedAt: string } | undefined
  #metricsCollection: Promise<void> | undefined
  #heartbeatSequence = 0
  #snapshotSequence = 0
  #snapshotTimer: NodeJS.Timeout | undefined
  #continuousSnapshots = false
  #snapshotAccepted = false
  #negotiatedProtocolMinor = 0
  #heartbeatIntervalMilliseconds = 10_000
  readonly #commands = new Map<string, CachedWorkerCommand>()
  #commandExecutionQueue: Promise<void> = Promise.resolve()
  #proxyProbeExecutionQueue: Promise<void> = Promise.resolve()
  readonly #proxyProbeAdapters = new Set<ProfileProxyAdapter>()
  readonly #profileExecutionQueues = new Map<string, Promise<void>>()
  readonly #profileCommands: ProfileRuntimeCommands | undefined
  #closed = false
  #downloadReporter: WorkerDownloadReporter | undefined
  #downloadServer: WorkerDownloadServer | undefined

  constructor(
    configuration: WorkerConfiguration,
    identity: StoredWorkerIdentity,
    logger: ServiceLogger,
    runtimeMonitor: WorkerRuntimeMonitor,
    profileRuntime?: ProfileRuntimeCommandPort,
    private readonly sessionRuntime?: SessionCommandPort,
    private readonly retainedDownloads?: WorkerRetainedDownloads,
  ) {
    this.#configuration = configuration
    this.#identity = identity
    this.#logger = logger
    this.#runtimeMonitor = runtimeMonitor
    this.#profileCommands =
      profileRuntime === undefined ? undefined : new ProfileRuntimeCommands(profileRuntime)
    this.#reconnectDelayMilliseconds = configuration.controlReconnectMinimumMilliseconds
  }

  get state(): WorkerControlState {
    return this.#state
  }

  get runtimeReady(): boolean {
    return this.#runtimeMonitor.capabilityReport.status === 'READY'
  }

  get latestMetrics():
    { readonly metrics: WorkerRuntimeMetrics; readonly observedAt: string } | undefined {
    return this.#latestMetrics
  }

  async start(): Promise<void> {
    if (this.#closed) throw new Error('Worker control client is closed')
    if (this.#state !== 'idle') throw new Error('Worker control client is already started')
    this.#setState('connecting')
    try {
      if (this.#configuration.downloads) {
        if (!this.retainedDownloads)
          throw new Error('Download listener requires retained download storage')
        this.#downloadServer = new WorkerDownloadServer(
          this.#configuration.downloads,
          this.retainedDownloads,
          new WorkerDownloadAuthorizer(
            this.#identity,
            this.#configuration.controlServerCaCertificatePem,
            this.#instanceId,
            () => this.#state === 'connected',
          ),
          (code) => this.#logger.error({ code }, 'Worker download persistence failed'),
        )
        await this.#downloadServer.start()
      }
      // A first genuine sample is required before advertising the control heartbeat. Subsequent
      // CDP/host observations run independently, keeping their original observation timestamp.
      await this.#refreshMetrics()
      if (this.#latestMetrics === undefined)
        throw new Error('Initial Worker metrics are unavailable')
      await this.#connect()
    } catch (cause) {
      await this.#downloadServer?.close()
      this.#downloadServer = undefined
      this.#setState('idle')
      throw cause
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await Promise.allSettled([...this.#proxyProbeAdapters].map((adapter) => adapter.close()))
    await this.#downloadServer?.close()
    await this.#downloadReporter?.close()
    await this.#runtimeMonitor.close()
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer)
    if (this.#heartbeatTimer !== undefined) clearTimeout(this.#heartbeatTimer)
    this.#reconnectTimer = undefined
    this.#heartbeatTimer = undefined
    if (this.#snapshotTimer !== undefined) clearTimeout(this.#snapshotTimer)
    this.#snapshotTimer = undefined
    this.#pendingHeartbeat = undefined
    const socket = this.#socket
    this.#socket = undefined
    this.#setState('closed')
    if (socket === undefined || socket.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => {
      const terminateTimer = setTimeout(() => {
        socket.terminate()
        resolve()
      }, 1_000)
      terminateTimer.unref()
      socket.once('close', () => {
        clearTimeout(terminateTimer)
        resolve()
      })
      socket.close(1000, 'Worker shutting down')
    })
  }

  async #connect(): Promise<void> {
    const socket = new WebSocket(this.#identity.controlUrl, {
      cert: this.#identity.certificatePem,
      key: this.#identity.privateKeyPem,
      ...(this.#configuration.controlServerCaCertificatePem === undefined
        ? {}
        : { ca: this.#configuration.controlServerCaCertificatePem }),
      rejectUnauthorized: true,
      handshakeTimeout: this.#configuration.controlHandshakeTimeoutMilliseconds,
      maxPayload: WORKER_CONTROL_MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      followRedirects: false,
    })
    socket.binaryType = 'arraybuffer'
    this.#socket = socket
    let revocationObserved = false
    const observeRevocation = (reason: string) => {
      if (revocationObserved || this.#socket !== socket || this.#closed) return
      revocationObserved = true
      void this.#closeRevokedSessions(reason)
    }
    socket.once('close', (code: number) => {
      if (code === 4008) observeRevocation('WORKER_DISABLED')
      else if (code === 4001) observeRevocation('WORKER_AUTHORIZATION_REVOKED')
    })
    socket.on('message', (data: RawData, isBinary: boolean) => {
      // A handshake error terminates the socket before its close frame may arrive.
      // Observe authenticated rejection in every negotiation phase before those handlers run.
      if (!isBinary || revocationObserved) return
      let message
      try {
        message = decodeWorkerControlMessage(toUint8Array(data))
      } catch {
        return // The phase-specific handler reports invalid protocol messages.
      }
      if (
        message.protocolMajor !== WORKER_CONTROL_PROTOCOL_MAJOR ||
        message.type !== 'protocol.error'
      )
        return
      if (message.payload.code === 'WORKER_DISABLED') observeRevocation('WORKER_DISABLED')
      else if (message.payload.code === 'AUTHORIZATION_FAILED')
        observeRevocation('WORKER_AUTHORIZATION_REVOKED')
    })
    const hello: WorkerHelloMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'worker.hello',
      messageId: createPublicId(),
      correlationId: null,
      sentAt: Date.now(),
      payload: {
        workerId: this.#identity.workerId,
        credentialId: this.#identity.credentialId,
        instanceId: this.#instanceId,
        workerVersion: BROWSHARE_VERSION,
        ...(this.#downloadServer
          ? { downloadEndpoint: this.#configuration.downloads!.endpoint }
          : {}),
        hostname: hostname(),
        platform: process.platform,
        architecture: process.arch,
      },
    }

    try {
      const accepted = await new Promise<WorkerHelloAcceptedMessage>((resolve, reject) => {
        let settled = false
        const finish = (cause: Error | undefined, response?: WorkerHelloAcceptedMessage) => {
          if (settled) return
          settled = true
          clearTimeout(handshakeTimer)
          socket.off('error', onError)
          socket.off('close', onCloseBeforeHello)
          socket.off('message', onMessage)
          if (cause === undefined && response !== undefined) resolve(response)
          else reject(cause)
        }
        const onError = (cause: Error) => finish(sanitizeConnectionError(cause))
        const onCloseBeforeHello = (code: number, reason: Buffer) => {
          finish(
            new Error(
              `Worker control connection closed before hello acceptance (${code}: ${reason.toString('utf8') || 'no reason'})`,
            ),
          )
        }
        const onMessage = (data: RawData, isBinary: boolean) => {
          if (!isBinary) {
            finish(new Error('Worker control server sent a non-binary handshake message'))
            return
          }
          let message
          try {
            message = decodeWorkerControlMessage(toUint8Array(data))
          } catch (cause) {
            finish(new Error('Worker control server sent an invalid handshake message', { cause }))
            return
          }
          if (message.type === 'protocol.error') {
            finish(
              new Error(
                `Worker control handshake rejected: ${message.payload.code}: ${message.payload.message}`,
              ),
            )
            return
          }
          if (
            message.type !== 'worker.hello.accepted' ||
            message.correlationId !== hello.messageId ||
            message.payload.workerId !== this.#identity.workerId ||
            message.protocolMajor !== WORKER_CONTROL_PROTOCOL_MAJOR
          ) {
            finish(new Error('Worker control hello acceptance does not match this Worker'))
            return
          }
          finish(undefined, message)
        }
        const handshakeTimer = setTimeout(
          () => finish(new Error('Worker control hello acceptance timed out')),
          this.#configuration.controlHandshakeTimeoutMilliseconds,
        )
        handshakeTimer.unref()
        socket.once('error', onError)
        socket.once('close', onCloseBeforeHello)
        socket.on('message', onMessage)
        socket.once('open', () => {
          socket.send(encodeWorkerControlMessage(hello), { binary: true })
        })
      })
      this.#continuousSnapshots = accepted.payload.negotiatedProtocolMinor >= 3
      this.#negotiatedProtocolMinor = accepted.payload.negotiatedProtocolMinor
      if (this.#downloadServer && this.#negotiatedProtocolMinor < 17)
        throw new Error('Worker download delivery requires Backend control protocol 1.17')
      if (this.retainedDownloads && this.#negotiatedProtocolMinor < 16)
        throw new Error('Worker retained downloads require Backend control protocol 1.16')
      this.#heartbeatIntervalMilliseconds = accepted.payload.heartbeatIntervalMilliseconds
      await this.#reportCapabilities(socket)
      if (this.#negotiatedProtocolMinor >= 20) {
        await this.#reconcileRuntime(socket)
      } else if (accepted.payload.snapshotRequired) {
        if (accepted.payload.negotiatedProtocolMinor < 1) {
          throw new Error('Worker control server requires a snapshot on an unsupported protocol')
        }
        await this.#reconcileRuntime(socket)
      }
    } catch (cause) {
      if (this.#socket === socket) this.#socket = undefined
      socket.terminate()
      throw cause
    }

    if (this.#socket !== socket || this.#closed) {
      socket.close(1000, 'Worker control client stopped')
      return
    }
    this.#reconnectDelayMilliseconds = this.#configuration.controlReconnectMinimumMilliseconds
    if (this.#negotiatedProtocolMinor < 20) this.#setState('connected')
    this.#logger.info(
      {
        workerId: this.#identity.workerId,
        controlOrigin: new URL(this.#identity.controlUrl).origin,
      },
      'Worker control channel connected',
    )
    if (this.#negotiatedProtocolMinor < 20) this.#installSocketHandlers(socket)
    this.#scheduleHeartbeat(socket, 0)
    if (this.#continuousSnapshots) this.#scheduleSnapshot(socket)
    if (this.retainedDownloads && this.#negotiatedProtocolMinor >= 16) {
      await this.#downloadReporter?.close()
      if (this.#closed || this.#socket !== socket || socket.readyState !== WebSocket.OPEN) return
      this.#downloadReporter = new WorkerDownloadReporter(
        socket,
        this.#identity.workerId,
        this.#instanceId,
        this.retainedDownloads,
        this.#configuration.controlHandshakeTimeoutMilliseconds,
        () => {
          this.#logger.warn(
            { workerId: this.#identity.workerId },
            'Worker download reconciliation failed',
          )
          socket.close(4005, 'Download reconciliation failed')
        },
      )
      this.#downloadReporter.start()
    }
  }

  #installSocketHandlers(socket: WebSocket): void {
    socket.on('message', (data, isBinary) => {
      if (this.#socket === socket) this.#handleMessage(data, isBinary)
    })
    socket.once('close', (code, reason) => this.#handleClose(socket, code, reason))
    socket.on('error', (cause) => {
      this.#logger.warn(
        { workerId: this.#identity.workerId, errorCode: readErrorCode(cause) },
        'Worker control socket failed',
      )
    })
  }

  async #reportCapabilities(socket: WebSocket): Promise<void> {
    const report: WorkerCapabilitiesMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'worker.capabilities',
      messageId: createPublicId(),
      correlationId: null,
      sentAt: Date.now(),
      payload: {
        workerId: this.#identity.workerId,
        report: this.#runtimeMonitor.capabilityReport,
      },
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (cause?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        socket.off('error', onError)
        socket.off('close', onClose)
        socket.off('message', onMessage)
        if (cause === undefined) resolve()
        else reject(cause)
      }
      const onError = (cause: Error) => finish(sanitizeConnectionError(cause))
      const onClose = (code: number, reason: Buffer) =>
        finish(
          new Error(
            `Worker control connection closed before capability acceptance (${code}: ${reason.toString('utf8') || 'no reason'})`,
          ),
        )
      const onMessage = (data: RawData, isBinary: boolean) => {
        if (!isBinary) {
          finish(new Error('Worker control server sent a non-binary capability response'))
          return
        }
        let message
        try {
          message = decodeWorkerControlMessage(toUint8Array(data))
        } catch (cause) {
          finish(new Error('Worker control server sent an invalid capability response', { cause }))
          return
        }
        if (message.type === 'protocol.error') {
          finish(
            new Error(
              `Worker capability report rejected: ${message.payload.code}: ${message.payload.message}`,
            ),
          )
          return
        }
        if (!isMatchingCapabilitiesAccepted(message, report, this.#identity.workerId)) {
          finish(new Error('Worker capability acceptance does not match this Worker'))
          return
        }
        if (this.#negotiatedProtocolMinor >= 20) {
          this.#snapshotAccepted = false
          this.#setState('reconciling')
          this.#installSocketHandlers(socket)
          this.#scheduleHeartbeat(socket, 0)
        }
        finish()
      }
      const timeout = setTimeout(
        () => finish(new Error('Worker capability acceptance timed out')),
        this.#configuration.controlHandshakeTimeoutMilliseconds,
      )
      timeout.unref()
      socket.once('error', onError)
      socket.once('close', onClose)
      socket.on('message', onMessage)
      socket.send(encodeWorkerControlMessage(report), { binary: true })
    })
  }

  async #reconcileRuntime(socket: WebSocket): Promise<void> {
    for (let round = 1; round <= MAX_RECONCILIATION_ROUNDS; round += 1) {
      const sequence = ++this.#snapshotSequence
      const snapshot: WorkerSnapshotMessage = {
        protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
        protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
        type: 'worker.snapshot',
        messageId: createPublicId(),
        correlationId: null,
        sentAt: Date.now(),
        payload: {
          workerId: this.#identity.workerId,
          snapshot: await this.#runtimeMonitor.collectRuntimeSnapshot(this.#instanceId, sequence),
        },
      }
      if (this.#negotiatedProtocolMinor < 8) {
        delete snapshot.payload.snapshot.closedSessions
        for (const fact of snapshot.payload.snapshot.sessions) {
          delete fact.recycling
          delete fact.lastInputAt
          delete fact.lastFrameChangedAt
        }
      }
      if (this.#negotiatedProtocolMinor < 20) {
        for (const fact of snapshot.payload.snapshot.sessions) delete fact.cleanupError
        for (const fact of snapshot.payload.snapshot.profiles) delete fact.cleanupError
      }
      if (this.#negotiatedProtocolMinor < 22)
        for (const fact of [
          ...snapshot.payload.snapshot.sessions,
          ...(snapshot.payload.snapshot.closedSessions ?? []),
        ])
          delete fact.pageScriptError
      const accepted = await this.#sendSnapshotAndWait(socket, snapshot)
      if (this.#negotiatedProtocolMinor >= 20) {
        if (this.#socket !== socket || this.#closed) return
        // Cleanup runs independently of heartbeats and unrelated commands. The next periodic
        // snapshot, not a rapid retry loop, proves completion or schedules another attempt.
        void this.#runtimeMonitor.applyReconciliationPlan(accepted.payload, true).catch(() => {
          if (this.#socket === socket) socket.close(4002, 'Invalid reconciliation plan')
        })
        return
      }
      await this.#runtimeMonitor.applyReconciliationPlan(accepted.payload)
      if (!accepted.payload.resnapshotRequired) return
    }
    throw new Error(
      `Worker reconciliation did not converge after ${MAX_RECONCILIATION_ROUNDS} rounds`,
    )
  }

  async #sendSnapshotAndWait(
    socket: WebSocket,
    snapshot: WorkerSnapshotMessage,
  ): Promise<WorkerSnapshotAcceptedMessage> {
    return new Promise<WorkerSnapshotAcceptedMessage>((resolve, reject) => {
      let settled = false
      const finish = (cause: Error | undefined, response?: WorkerSnapshotAcceptedMessage) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        socket.off('error', onError)
        socket.off('close', onClose)
        socket.off('message', onMessage)
        if (cause === undefined && response !== undefined) resolve(response)
        else reject(cause)
      }
      const onError = (cause: Error) => finish(sanitizeConnectionError(cause))
      const onClose = (code: number, reason: Buffer) =>
        finish(
          new Error(
            `Worker control connection closed before snapshot acceptance (${code}: ${reason.toString('utf8') || 'no reason'})`,
          ),
        )
      const onMessage = (data: RawData, isBinary: boolean) => {
        if (!isBinary) {
          finish(new Error('Worker control server sent a non-binary snapshot response'))
          return
        }
        let message
        try {
          message = decodeWorkerControlMessage(toUint8Array(data))
        } catch (cause) {
          finish(new Error('Worker control server sent an invalid snapshot response', { cause }))
          return
        }
        if (message.type === 'protocol.error' && message.correlationId === snapshot.messageId) {
          finish(
            new Error(
              `Worker runtime snapshot rejected: ${message.payload.code}: ${message.payload.message}`,
            ),
          )
          return
        }
        if (message.type !== 'worker.snapshot.accepted') return
        if (
          message.type !== 'worker.snapshot.accepted' ||
          message.protocolMajor !== WORKER_CONTROL_PROTOCOL_MAJOR ||
          message.correlationId !== snapshot.messageId ||
          message.payload.workerId !== this.#identity.workerId ||
          message.payload.instanceId !== this.#instanceId ||
          message.payload.sequence !== snapshot.payload.snapshot.sequence ||
          message.payload.resnapshotRequired !==
            (message.payload.closeSessions.length > 0 || message.payload.stopProfiles.length > 0)
        ) {
          finish(new Error('Worker snapshot acceptance does not match this runtime snapshot'))
          return
        }
        if (this.#negotiatedProtocolMinor >= 20) {
          this.#snapshotAccepted = !message.payload.resnapshotRequired
          this.#setState(this.#snapshotAccepted ? 'connected' : 'reconciling')
        }
        finish(undefined, message)
      }
      const timeout = setTimeout(
        () => finish(new Error('Worker runtime snapshot acceptance timed out')),
        this.#configuration.controlHandshakeTimeoutMilliseconds,
      )
      timeout.unref()
      socket.once('error', onError)
      socket.once('close', onClose)
      socket.on('message', onMessage)
      socket.send(encodeWorkerControlMessage(snapshot), { binary: true })
    })
  }

  #handleMessage(data: RawData, isBinary: boolean): void {
    if (!isBinary) {
      this.#socket?.close(4002, 'Binary MessagePack required')
      return
    }
    let message
    try {
      message = decodeWorkerControlMessage(toUint8Array(data))
    } catch (cause) {
      this.#logger.warn(
        { workerId: this.#identity.workerId, errorCode: readErrorCode(cause) },
        'Invalid Worker control message received',
      )
      this.#socket?.close(4002, 'Invalid control message')
      return
    }
    if (message.type === 'protocol.error') {
      this.#logger.warn(
        { workerId: this.#identity.workerId, protocolErrorCode: message.payload.code },
        message.payload.message,
      )
      return
    }
    if (message.type === 'worker.snapshot.accepted') return // The correlated snapshot waiter validates this response.
    if (message.type === 'worker.downloads.accepted') return // The download reporter validates correlation and terminal IDs.
    if (message.type === 'worker.heartbeat.ack') {
      this.#acceptHeartbeatAcknowledgement(message)
      return
    }
    if (
      message.type === 'diagnostic.probe' ||
      message.type === 'proxy.probe' ||
      message.type === 'storage.policy.set' ||
      message.type === 'profile.runtime.set' ||
      message.type === 'session.close' ||
      message.type === 'session.create' ||
      message.type === 'session.continue' ||
      message.type === 'session.viewer.prepare'
    ) {
      this.#acceptCommand(message)
      return
    }
    this.#logger.warn(
      { workerId: this.#identity.workerId, messageType: message.type },
      'Unexpected Worker control message received',
    )
    this.#socket?.close(4002, 'Unexpected control message')
  }

  #acceptCommand(message: WorkerCommand): void {
    if (message.payload.workerId !== this.#identity.workerId) {
      this.#sendProtocolError(
        message.messageId,
        'AUTHORIZATION_FAILED',
        'Worker command identity does not match this Worker.',
      )
      this.#socket?.close(4001, 'Worker command identity mismatch')
      return
    }

    if (message.type !== 'diagnostic.probe' && message.payload.instanceId !== this.#instanceId) {
      this.#sendProtocolError(
        message.messageId,
        'INVALID_MESSAGE',
        'Runtime command targets another Worker process',
      )
      return
    }
    if (
      this.#negotiatedProtocolMinor >= 20 &&
      !this.#snapshotAccepted &&
      !isWorkerRecoveryCommand(message)
    ) {
      this.#sendProtocolError(
        message.messageId,
        'WORKER_RECONCILING',
        'Worker reconciliation must finish before this operation.',
      )
      return
    }

    const cached = this.#commands.get(message.messageId)
    if (cached !== undefined) {
      if (
        cached.command.type !== message.type ||
        !isDeepStrictEqual(cached.command.payload, message.payload)
      ) {
        this.#sendProtocolError(
          message.messageId,
          'COMMAND_ID_REUSED',
          'A command message ID was reused with different content.',
        )
        this.#socket?.close(4002, 'Worker command message ID reused')
        return
      }
      this.#logger.info(
        {
          workerId: this.#identity.workerId,
          commandId: message.messageId,
          commandType: message.type,
          resultCached: cached.result !== undefined,
        },
        'Worker command replayed from idempotency cache',
      )
      this.#sendControlMessage(cached.acknowledgement)
      if (cached.result !== undefined) this.#sendControlMessage(cached.result)
      return
    }

    this.#pruneCommands()
    if (this.#commands.size >= COMMAND_CACHE_LIMIT) {
      this.#sendProtocolError(
        message.messageId,
        'COMMAND_CAPACITY_EXCEEDED',
        'The Worker command cache is at capacity.',
      )
      return
    }

    const acknowledgement: WorkerCommandAcceptedMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'worker.command.accepted',
      messageId: createPublicId(),
      correlationId: message.messageId,
      sentAt: Date.now(),
      payload: {
        workerId: this.#identity.workerId,
        commandType: message.type,
        acceptedAt: new Date().toISOString(),
      },
    }
    const entry: CachedWorkerCommand = { command: message, acknowledgement }
    this.#commands.set(message.messageId, entry)
    this.#sendControlMessage(acknowledgement)

    if (message.type === 'storage.policy.set') {
      void this.#runStoragePolicy(entry)
    } else if (message.type === 'proxy.probe') {
      // Administrative network probes cannot flood outbound sockets or delay system diagnostics.
      this.#proxyProbeExecutionQueue = this.#proxyProbeExecutionQueue
        .then(() => this.#runProxyProbe(entry))
        .catch(() => undefined)
    } else if (message.type === 'session.close') {
      // Cleanup must be able to cancel creation while a Profile is still starting.
      void this.#runSessionClose(entry)
    } else if (message.type === 'session.create') {
      void this.#runSessionCreate(entry)
    } else if (message.type === 'session.continue') {
      void this.#runSessionContinue(entry)
    } else if (message.type === 'session.viewer.prepare') {
      void this.#runSessionViewer(entry)
    } else if (message.type === 'profile.runtime.set') {
      const profileId = message.payload.profileId
      const previous = this.#profileExecutionQueues.get(profileId) ?? Promise.resolve()
      const execution = previous.then(() => this.#runProfileCommand(entry))
      const settled = execution
        .catch(() => undefined)
        .finally(() => {
          if (this.#profileExecutionQueues.get(profileId) === settled)
            this.#profileExecutionQueues.delete(profileId)
        })
      this.#profileExecutionQueues.set(profileId, settled)
    } else {
      const execution = this.#commandExecutionQueue.then(() => this.#runDiagnosticProbe(entry))
      this.#commandExecutionQueue = execution.catch(() => undefined)
    }
  }

  async #runStoragePolicy(entry: CachedWorkerCommand): Promise<void> {
    const command = entry.command
    if (command.type !== 'storage.policy.set')
      throw new TypeError('Expected storage policy command')
    let result: WorkerStoragePolicyResultMessage | WorkerControlErrorMessage
    try {
      if (this.#closed || Date.parse(command.payload.expiresAt) <= Date.now())
        throw new Error('Storage policy command expired')
      const facts = await this.#runtimeMonitor.applyStoragePolicy(
        command.payload.workerPolicy,
        command.payload.profilePolicy,
      )
      result = {
        protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
        protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
        type: 'storage.policy.result',
        messageId: createPublicId(),
        correlationId: command.messageId,
        sentAt: Date.now(),
        payload: { workerId: this.#identity.workerId, instanceId: this.#instanceId, ...facts },
      }
    } catch {
      result = {
        protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
        protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
        type: 'protocol.error',
        messageId: createPublicId(),
        correlationId: command.messageId,
        sentAt: Date.now(),
        payload: { code: 'INVALID_MESSAGE', message: 'The storage policy could not be applied.' },
      }
    }
    entry.result = result
    entry.completedAt = Date.now()
    this.#sendControlMessage(result)
    this.#pruneCommands()
  }

  async #runProxyProbe(entry: CachedWorkerCommand): Promise<void> {
    const command = entry.command
    if (command.type !== 'proxy.probe') throw new TypeError('Expected Proxy probe command')
    let adapter: ProfileProxyAdapter | undefined
    let report: ProxyExitIpResult = {
      status: 'UNHEALTHY',
      checkedAt: new Date().toISOString(),
      latencyMilliseconds: 0,
      httpStatus: null,
      errorCode: 'PROXY_CHECK_CANCELLED',
      exitIp: null,
    }
    let commandError: string | undefined
    try {
      const remaining = Date.parse(command.payload.expiresAt) - Date.now()
      if (remaining <= 0) commandError = 'COMMAND_EXPIRED'
      else if (this.#closed || this.#socket?.readyState !== WebSocket.OPEN)
        commandError = 'PROXY_CHECK_CANCELLED'
      else {
        adapter = new ProfileProxyAdapter(command.payload.proxy)
        this.#proxyProbeAdapters.add(adapter)
        await adapter.start()
        const timeout = Math.min(10_000, Date.parse(command.payload.expiresAt) - Date.now())
        if (timeout <= 0) commandError = 'COMMAND_EXPIRED'
        else if (command.payload.mode === 'exit-ip')
          report = await adapter.checkExitIp(command.payload.targetUrl, timeout)
        else
          report = {
            ...(await adapter.checkHealth(command.payload.targetUrl, timeout)),
            exitIp: null,
          }
      }
    } catch {
      commandError = 'PROXY_PROBE_FAILED'
    } finally {
      if (adapter !== undefined) {
        try {
          await adapter.close()
        } catch {
          commandError = 'PROXY_PROBE_CLEANUP_FAILED'
        }
        this.#proxyProbeAdapters.delete(adapter)
      }
    }
    const result: WorkerProxyProbeResultMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'proxy.probe.result',
      messageId: createPublicId(),
      correlationId: command.messageId,
      sentAt: Date.now(),
      payload: {
        ...report,
        ...(commandError === undefined
          ? {}
          : {
              status: 'UNHEALTHY',
              checkedAt: new Date().toISOString(),
              errorCode: commandError,
              exitIp: null,
            }),
        lastSucceededAt:
          commandError === undefined && report.status === 'HEALTHY' ? report.checkedAt : null,
        workerId: this.#identity.workerId,
        instanceId: this.#instanceId,
        proxyId: command.payload.proxyId,
        configurationVersion: command.payload.configurationVersion,
        mode: command.payload.mode,
      },
    }
    entry.result = result
    entry.completedAt = Date.now()
    this.#logger.info(
      {
        workerId: this.#identity.workerId,
        commandId: command.messageId,
        commandType: command.type,
        errorCode: result.payload.errorCode,
      },
      'Worker Proxy probe completed',
    )
    this.#sendControlMessage(result)
    this.#pruneCommands()
  }

  async #runDiagnosticProbe(entry: CachedWorkerCommand): Promise<void> {
    if (entry.command.type !== 'diagnostic.probe')
      throw new TypeError('Expected diagnostic command')
    let result: WorkerDiagnosticProbeResultMessage
    if (Date.parse(entry.command.payload.expiresAt) <= Date.now()) {
      result = this.#diagnosticFailure(
        entry.command,
        'COMMAND_EXPIRED',
        'The diagnostic command expired before execution began.',
      )
    } else {
      try {
        const report = await this.#runtimeMonitor.refreshCapabilities()
        result = {
          protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
          protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
          type: 'diagnostic.probe.result',
          messageId: createPublicId(),
          correlationId: entry.command.messageId,
          sentAt: Date.now(),
          payload: {
            workerId: this.#identity.workerId,
            outcome: 'SUCCEEDED',
            completedAt: new Date().toISOString(),
            report,
            error: null,
          },
        }
      } catch (cause) {
        result = this.#diagnosticFailure(
          entry.command,
          readErrorCode(cause) ?? 'DIAGNOSTIC_PROBE_FAILED',
          cause instanceof Error
            ? cause.message.slice(0, 512)
            : 'The Worker capability probe failed unexpectedly.',
        )
      }
    }
    entry.result = result
    entry.completedAt = Date.now()
    this.#logger.info(
      {
        workerId: this.#identity.workerId,
        commandId: entry.command.messageId,
        commandType: entry.command.type,
        commandOutcome: result.payload.outcome,
      },
      'Worker command completed',
    )
    this.#sendControlMessage(result)
    this.#pruneCommands()
  }

  async #runProfileCommand(entry: CachedWorkerCommand): Promise<void> {
    const command = entry.command
    if (command.type !== 'profile.runtime.set') throw new TypeError('Expected Profile command')
    let runtime: WorkerProfileRuntimeResultMessage['payload']['runtime'] = null
    let error: WorkerProfileRuntimeResultMessage['payload']['error'] = null
    try {
      if (this.#closed) throw new ProfileChromeError('WORKER_CLOSING', 'Worker is shutting down')
      if (Date.parse(command.payload.expiresAt) <= Date.now())
        throw new ProfileChromeError('COMMAND_EXPIRED', 'Runtime command expired before execution')
      if (this.#profileCommands === undefined)
        throw new ProfileChromeError(
          'REMOTE_TAB_RUNTIME_UNAVAILABLE',
          'The managed Runtime is not enabled',
        )
      runtime = await this.#profileCommands.execute(command)
    } catch (cause) {
      error =
        cause instanceof ProfileChromeError || cause instanceof StorageProtectionError
          ? { code: cause.code.slice(0, 128), message: cause.message.slice(0, 512) }
          : {
              code: 'PROFILE_RUNTIME_OPERATION_FAILED',
              message: 'The Profile Runtime operation failed',
            }
    }
    const result: WorkerProfileRuntimeResultMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'profile.runtime.result',
      messageId: createPublicId(),
      correlationId: command.messageId,
      sentAt: Date.now(),
      payload: {
        workerId: this.#identity.workerId,
        instanceId: this.#instanceId,
        profileId: command.payload.profileId,
        generation: command.payload.generation,
        action: command.payload.action,
        completedAt: new Date().toISOString(),
        outcome: error === null ? 'SUCCEEDED' : 'FAILED',
        runtime,
        error,
      },
    }
    entry.result = result
    entry.completedAt = Date.now()
    this.#logger.info(
      {
        workerId: this.#identity.workerId,
        commandId: command.messageId,
        commandType: command.type,
        profileId: command.payload.profileId,
        commandOutcome: result.payload.outcome,
        errorCode: error?.code,
      },
      'Worker command completed',
    )
    this.#sendControlMessage(result)
    this.#pruneCommands()
  }

  async #runSessionCreate(entry: CachedWorkerCommand): Promise<void> {
    const command = entry.command
    if (command.type !== 'session.create') throw new TypeError('Expected Session create command')
    let fact: WorkerSessionCreateResultMessage['payload']['fact'] = null
    let error: WorkerSessionCreateResultMessage['payload']['error'] = null
    try {
      if (this.#closed) throw new WorkerSessionError('WORKER_CLOSING', 'Worker is shutting down')
      if (Date.parse(command.payload.expiresAt) <= Date.now())
        throw new WorkerSessionError('COMMAND_EXPIRED', 'Session creation command expired')
      if (this.sessionRuntime === undefined)
        throw new WorkerSessionError(
          'REMOTE_TAB_RUNTIME_UNAVAILABLE',
          'Session runtime is not enabled',
        )
      fact = await executeSessionCreate(this.sessionRuntime, command)
    } catch (cause) {
      error =
        cause instanceof WorkerSessionError || cause instanceof StorageProtectionError
          ? { code: cause.code.slice(0, 128), message: cause.message.slice(0, 512) }
          : { code: 'SESSION_CREATE_FAILED', message: 'The Session could not be created' }
    }
    const { workerId, instanceId, sessionId, profileId, runtimeId, profileGeneration } =
      command.payload
    const result: WorkerSessionCreateResultMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'session.create.result',
      messageId: createPublicId(),
      correlationId: command.messageId,
      sentAt: Date.now(),
      payload: {
        workerId,
        instanceId,
        sessionId,
        profileId,
        runtimeId,
        profileGeneration,
        completedAt: new Date().toISOString(),
        outcome: error === null ? 'SUCCEEDED' : 'FAILED',
        fact,
        error,
      },
    }
    entry.result = result
    entry.completedAt = Date.now()
    this.#logger.info(
      {
        commandId: command.messageId,
        sessionId,
        commandType: command.type,
        commandOutcome: result.payload.outcome,
        errorCode: error?.code,
      },
      'Worker command completed',
    )
    this.#sendControlMessage(result)
    this.#pruneCommands()
  }

  async #runSessionViewer(entry: CachedWorkerCommand): Promise<void> {
    const command = entry.command
    if (command.type !== 'session.viewer.prepare') throw new TypeError('Expected Viewer command')
    let fact: WorkerSessionViewerResultMessage['payload']['fact'] = null
    let error: WorkerSessionViewerResultMessage['payload']['error'] = null
    try {
      if (this.#closed) throw new WorkerSessionError('WORKER_CLOSING', 'Worker is shutting down')
      if (Date.parse(command.payload.expiresAt) <= Date.now())
        throw new WorkerSessionError('COMMAND_EXPIRED', 'Viewer command expired')
      if (this.sessionRuntime === undefined)
        throw new WorkerSessionError(
          'REMOTE_TAB_RUNTIME_UNAVAILABLE',
          'Session runtime is not enabled',
        )
      fact = await executeSessionViewer(this.sessionRuntime, command)
    } catch (cause) {
      error =
        cause instanceof WorkerSessionError || cause instanceof StorageProtectionError
          ? { code: cause.code.slice(0, 128), message: cause.message.slice(0, 512) }
          : {
              code: 'VIEWER_PREPARATION_FAILED',
              message: 'The Viewer connection could not be prepared',
            }
    }
    const { workerId, instanceId, sessionId, profileId, runtimeId, profileGeneration } =
      command.payload
    const result: WorkerSessionViewerResultMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'session.viewer.result',
      messageId: createPublicId(),
      correlationId: command.messageId,
      sentAt: Date.now(),
      payload: {
        workerId,
        instanceId,
        sessionId,
        profileId,
        runtimeId,
        profileGeneration,
        completedAt: new Date().toISOString(),
        outcome: error === null ? 'SUCCEEDED' : 'FAILED',
        fact,
        error,
      },
    }
    entry.result = result
    entry.completedAt = Date.now()
    this.#logger.info(
      {
        commandId: command.messageId,
        sessionId,
        commandType: command.type,
        commandOutcome: result.payload.outcome,
        errorCode: error?.code,
      },
      'Worker command completed',
    )
    this.#sendControlMessage(result)
  }

  async #runSessionContinue(entry: CachedWorkerCommand): Promise<void> {
    const command = entry.command
    if (command.type !== 'session.continue') throw new TypeError('Expected Viewer command')
    let fact: WorkerSessionContinueResultMessage['payload']['fact'] = null
    let error: WorkerSessionContinueResultMessage['payload']['error'] = null
    try {
      if (this.#closed) throw new WorkerSessionError('WORKER_CLOSING', 'Worker is shutting down')
      if (Date.parse(command.payload.expiresAt) <= Date.now())
        throw new WorkerSessionError('COMMAND_EXPIRED', 'Viewer command expired')
      if (this.sessionRuntime === undefined)
        throw new WorkerSessionError(
          'REMOTE_TAB_RUNTIME_UNAVAILABLE',
          'Session runtime is not enabled',
        )
      fact = await executeSessionContinue(this.sessionRuntime, command)
    } catch (cause) {
      error =
        cause instanceof WorkerSessionError || cause instanceof StorageProtectionError
          ? { code: cause.code.slice(0, 128), message: cause.message.slice(0, 512) }
          : {
              code: 'SESSION_CONTINUE_FAILED',
              message: 'The Session could not be continued',
            }
    }
    const { workerId, instanceId, sessionId, profileId, runtimeId, profileGeneration } =
      command.payload
    const result: WorkerSessionContinueResultMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'session.continue.result',
      messageId: createPublicId(),
      correlationId: command.messageId,
      sentAt: Date.now(),
      payload: {
        workerId,
        instanceId,
        sessionId,
        profileId,
        runtimeId,
        profileGeneration,
        completedAt: new Date().toISOString(),
        outcome: error === null ? 'SUCCEEDED' : 'FAILED',
        fact,
        error,
      },
    }
    entry.result = result
    entry.completedAt = Date.now()
    this.#logger.info(
      {
        commandId: command.messageId,
        sessionId,
        commandType: command.type,
        commandOutcome: result.payload.outcome,
        errorCode: error?.code,
      },
      'Worker command completed',
    )
    this.#sendControlMessage(result)
  }

  async #runSessionClose(entry: CachedWorkerCommand): Promise<void> {
    const command = entry.command
    if (command.type !== 'session.close') throw new TypeError('Expected Session close command')
    let error: WorkerSessionCloseResultMessage['payload']['error'] = null
    try {
      if (this.#closed) throw new WorkerSessionError('WORKER_CLOSING', 'Worker is shutting down')
      if (Date.parse(command.payload.expiresAt) <= Date.now())
        throw new WorkerSessionError('COMMAND_EXPIRED', 'Session close command expired')
      if (this.sessionRuntime === undefined)
        throw new WorkerSessionError(
          'REMOTE_TAB_RUNTIME_UNAVAILABLE',
          'Session runtime is not enabled',
        )
      await executeSessionClose(this.sessionRuntime, command)
    } catch (cause) {
      error =
        cause instanceof WorkerSessionError || cause instanceof StorageProtectionError
          ? { code: cause.code.slice(0, 128), message: cause.message.slice(0, 512) }
          : { code: 'SESSION_CLOSE_FAILED', message: 'The Session could not be fully cleaned up' }
    }
    const { workerId, instanceId, sessionId, profileId, runtimeId, profileGeneration } =
      command.payload
    const result: WorkerSessionCloseResultMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'session.close.result',
      messageId: createPublicId(),
      correlationId: command.messageId,
      sentAt: Date.now(),
      payload: {
        workerId,
        instanceId,
        sessionId,
        profileId,
        runtimeId,
        profileGeneration,
        completedAt: new Date().toISOString(),
        outcome: error === null ? 'SUCCEEDED' : 'FAILED',
        error,
      },
    }
    entry.result = result
    entry.completedAt = Date.now()
    this.#logger.info(
      {
        commandId: command.messageId,
        sessionId,
        commandType: command.type,
        commandOutcome: result.payload.outcome,
        errorCode: error?.code,
      },
      'Worker command completed',
    )
    this.#sendControlMessage(result)
    this.#pruneCommands()
  }

  #diagnosticFailure(
    command: WorkerDiagnosticProbeCommandMessage,
    code: string,
    message: string,
  ): WorkerDiagnosticProbeResultMessage {
    const completedAt = new Date().toISOString()
    return {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'diagnostic.probe.result',
      messageId: createPublicId(),
      correlationId: command.messageId,
      sentAt: Date.now(),
      payload: {
        workerId: this.#identity.workerId,
        outcome: 'FAILED',
        completedAt,
        report: null,
        error: { code: code.slice(0, 128), message: message.slice(0, 512) },
      },
    }
  }

  #sendProtocolError(correlationId: string, code: WorkerControlErrorCode, message: string): void {
    const response: WorkerControlErrorMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'protocol.error',
      messageId: createPublicId(),
      correlationId,
      sentAt: Date.now(),
      payload: { code, message },
    }
    this.#sendControlMessage(response)
  }

  #sendControlMessage(
    message: WorkerCommandAcceptedMessage | WorkerCommandResult | WorkerControlErrorMessage,
  ): void {
    const socket = this.#socket
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) return
    if (this.#negotiatedProtocolMinor < 22 && 'fact' in message.payload && message.payload.fact) {
      message = structuredClone(message)
      if ('fact' in message.payload && message.payload.fact)
        delete message.payload.fact.pageScriptError
    }
    if (this.#negotiatedProtocolMinor < 20) {
      message = structuredClone(message)
      if (message.type === 'profile.runtime.result' && message.payload.runtime)
        delete message.payload.runtime.cleanupError
      if ('fact' in message.payload && message.payload.fact)
        delete message.payload.fact.cleanupError
    }
    socket.send(encodeWorkerControlMessage(message), { binary: true })
  }

  #pruneCommands(): void {
    const expiry = Date.now() - COMMAND_CACHE_TTL_MILLISECONDS
    for (const [messageId, entry] of this.#commands) {
      if (entry.completedAt !== undefined && entry.completedAt < expiry) {
        this.#commands.delete(messageId)
      }
    }
    if (this.#commands.size < COMMAND_CACHE_LIMIT) return
    const completed = [...this.#commands.entries()]
      .filter((entry): entry is [string, CachedWorkerCommand & { completedAt: number }] =>
        Number.isFinite(entry[1].completedAt),
      )
      .sort((left, right) => left[1].completedAt - right[1].completedAt)
    for (const [messageId] of completed) {
      if (this.#commands.size < COMMAND_CACHE_LIMIT) break
      this.#commands.delete(messageId)
    }
  }

  #acceptHeartbeatAcknowledgement(message: WorkerHeartbeatAcknowledgedMessage): void {
    const pending = this.#pendingHeartbeat
    if (
      pending === undefined ||
      message.payload.workerId !== this.#identity.workerId ||
      message.correlationId !== pending.messageId ||
      message.payload.sequence !== pending.sequence
    ) {
      this.#logger.warn(
        { workerId: this.#identity.workerId },
        'Worker heartbeat acknowledgement does not match the pending heartbeat',
      )
      this.#socket?.close(4002, 'Heartbeat acknowledgement mismatch')
      return
    }
    this.#pendingHeartbeat = undefined
  }

  #scheduleSnapshot(socket: WebSocket): void {
    if (this.#closed || this.#socket !== socket || this.#snapshotTimer !== undefined) return
    this.#snapshotTimer = setTimeout(() => {
      this.#snapshotTimer = undefined
      void this.#reconcileRuntime(socket)
        .catch((cause: unknown) => {
          if (this.#socket !== socket || this.#closed) return
          this.#logger.warn(
            { workerId: this.#identity.workerId, errorCode: readErrorCode(cause) },
            'Worker periodic snapshot failed',
          )
          socket.close(4005, 'Runtime snapshot failed')
        })
        .finally(() => {
          if (socket.readyState === WebSocket.OPEN) this.#scheduleSnapshot(socket)
        })
    }, this.#heartbeatIntervalMilliseconds)
    this.#snapshotTimer.unref()
  }

  #scheduleHeartbeat(socket: WebSocket, delayMilliseconds: number): void {
    if (this.#closed || this.#socket !== socket || this.#heartbeatTimer !== undefined) return
    this.#heartbeatTimer = setTimeout(() => {
      this.#heartbeatTimer = undefined
      this.#heartbeatTick(socket)
    }, delayMilliseconds)
    this.#heartbeatTimer.unref()
  }

  #heartbeatTick(socket: WebSocket): void {
    if (
      this.#socket !== socket ||
      socket.readyState !== WebSocket.OPEN ||
      !['connected', 'reconciling'].includes(this.#state)
    ) {
      return
    }
    const pending = this.#pendingHeartbeat
    if (pending !== undefined) {
      const acknowledgementTimeout = Math.max(
        this.#configuration.heartbeatAcknowledgementTimeoutMilliseconds,
        this.#heartbeatIntervalMilliseconds * 3,
      )
      const elapsed = Date.now() - pending.sentAt
      if (elapsed >= acknowledgementTimeout) {
        this.#logger.warn(
          { workerId: this.#identity.workerId, heartbeatSequence: pending.sequence },
          'Worker heartbeat acknowledgement timed out',
        )
        socket.close(4005, 'Heartbeat acknowledgement timeout')
        return
      }
      this.#scheduleHeartbeat(
        socket,
        Math.min(this.#heartbeatIntervalMilliseconds, acknowledgementTimeout - elapsed),
      )
      return
    }
    if (socket.bufferedAmount > WORKER_CONTROL_MAX_MESSAGE_BYTES) {
      this.#logger.warn(
        { workerId: this.#identity.workerId, bufferedBytes: socket.bufferedAmount },
        'Worker control channel is backpressured',
      )
      socket.close(4005, 'Worker control backpressure')
      return
    }

    // Telemetry must not become the liveness clock: a frozen Chrome can delay CDP sampling.
    // Reuse only a completed real sample, with its actual observedAt, while one refresh runs.
    void this.#refreshMetrics()
    const sample = this.#latestMetrics
    if (sample === undefined) throw new Error('Worker heartbeat has no initial metrics sample')
    try {
      const sequence = ++this.#heartbeatSequence
      const heartbeat: WorkerHeartbeatMessage = {
        protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
        protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
        type: 'worker.heartbeat',
        messageId: createPublicId(),
        correlationId: null,
        sentAt: Date.now(),
        payload: {
          workerId: this.#identity.workerId,
          sequence,
          observedAt: sample.observedAt,
          metrics: sample.metrics,
          ...this.#runtimeMonitor.collectStorageFacts(),
        },
      }
      if (this.#socket !== socket || socket.readyState !== WebSocket.OPEN) return
      this.#pendingHeartbeat = { messageId: heartbeat.messageId, sequence, sentAt: Date.now() }
      socket.send(encodeWorkerControlMessage(heartbeat), { binary: true }, (cause) => {
        if (cause != null && this.#socket === socket) {
          this.#logger.warn(
            {
              workerId: this.#identity.workerId,
              errorCode: readErrorCode(cause),
              errorMessage: cause.message.slice(0, 256),
            },
            'Worker heartbeat could not be sent',
          )
          socket.close(4005, 'Heartbeat send failed')
        }
      })
    } catch (cause) {
      this.#logger.warn(
        { workerId: this.#identity.workerId, errorCode: readErrorCode(cause) },
        'Worker heartbeat could not be encoded',
      )
    }
    this.#scheduleHeartbeat(socket, this.#heartbeatIntervalMilliseconds)
  }

  #refreshMetrics(): Promise<void> {
    if (this.#metricsCollection !== undefined) return this.#metricsCollection
    const observedAt = new Date().toISOString()
    const collection = this.#runtimeMonitor
      .collectMetrics()
      .then((metrics) => {
        if (!this.#closed) this.#latestMetrics = { metrics, observedAt }
      })
      .catch((cause: unknown) => {
        this.#logger.warn(
          { workerId: this.#identity.workerId, errorCode: readErrorCode(cause) },
          'Worker metrics collection failed',
        )
      })
      .finally(() => {
        if (this.#metricsCollection === collection) this.#metricsCollection = undefined
      })
    this.#metricsCollection = collection
    return collection
  }

  #handleClose(socket: WebSocket, code: number, reason: Buffer): void {
    if (this.#socket !== socket) return
    this.#socket = undefined
    void Promise.allSettled([...this.#proxyProbeAdapters].map((adapter) => adapter.close()))
    void this.#downloadReporter?.close()
    if (this.#heartbeatTimer !== undefined) clearTimeout(this.#heartbeatTimer)
    this.#heartbeatTimer = undefined
    if (this.#snapshotTimer !== undefined) clearTimeout(this.#snapshotTimer)
    this.#snapshotTimer = undefined
    this.#pendingHeartbeat = undefined
    if (this.#closed) return
    this.#logger.warn(
      {
        workerId: this.#identity.workerId,
        closeCode: code,
        closeReason: reason.toString('utf8').slice(0, 128),
      },
      'Worker control channel disconnected',
    )
    if ([4001, 4002, 4003, 4012].includes(code)) {
      this.#closed = true
      this.#setState('closed')
      return
    }
    this.#scheduleReconnect()
  }

  async #closeRevokedSessions(reason: string): Promise<void> {
    if (this.sessionRuntime === undefined) return
    try {
      const facts = await this.sessionRuntime.readRuntimeFacts()
      const outcomes = await Promise.allSettled(
        facts.sessions.map((f) => this.sessionRuntime!.closeTabSession(f.sessionId, reason)),
      )
      if (outcomes.some((outcome) => outcome.status === 'rejected'))
        this.#logger.error(
          { workerId: this.#identity.workerId, reason },
          'Revoked Session cleanup needs reconciliation',
        )
    } catch {
      this.#logger.error(
        { workerId: this.#identity.workerId, reason },
        'Revoked Session cleanup failed',
      )
    }
  }

  #scheduleReconnect(): void {
    if (this.#closed || this.#reconnectTimer !== undefined) return
    this.#setState('reconnecting')
    const jitter = 0.8 + Math.random() * 0.4
    const delay = Math.round(this.#reconnectDelayMilliseconds * jitter)
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined
      void this.#connect().catch((cause: unknown) => {
        this.#logger.warn(
          { workerId: this.#identity.workerId, errorCode: readErrorCode(cause) },
          'Worker control reconnect failed',
        )
        this.#reconnectDelayMilliseconds = Math.min(
          this.#reconnectDelayMilliseconds * 2,
          this.#configuration.controlReconnectMaximumMilliseconds,
        )
        this.#scheduleReconnect()
      })
    }, delay)
    this.#reconnectTimer.unref()
  }

  #setState(state: WorkerControlState): void {
    this.#state = state
  }
}

function isMatchingCapabilitiesAccepted(
  message: WorkerCapabilitiesAcceptedMessage | ReturnType<typeof decodeWorkerControlMessage>,
  report: WorkerCapabilitiesMessage,
  workerId: string,
): message is WorkerCapabilitiesAcceptedMessage {
  return (
    message.type === 'worker.capabilities.accepted' &&
    message.correlationId === report.messageId &&
    message.payload.workerId === workerId &&
    message.protocolMajor === WORKER_CONTROL_PROTOCOL_MAJOR
  )
}

function toUint8Array(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return Buffer.concat(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function sanitizeConnectionError(cause: Error): Error {
  const error = new Error(`Worker control TLS/WebSocket connection failed: ${cause.message}`)
  error.name = cause.name
  return error
}

function readErrorCode(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined
  return typeof cause.code === 'string' ? cause.code : undefined
}
