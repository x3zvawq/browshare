import { StorageControlService } from './storage-control.js'
import { CommandMetrics } from './command-metrics.js'
import type {
  WorkerStoragePolicyCommandMessage,
  WorkerStoragePolicyResultMessage,
} from '@browshare/contracts'
import { isIP } from 'node:net'
import { Buffer } from 'node:buffer'
import { X509Certificate } from 'node:crypto'
import { createServer, type Server as HttpsServer } from 'node:https'
import type { TLSSocket } from 'node:tls'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Value } from 'typebox/value'

import {
  BrowShareError,
  createPublicId,
  isPublicId,
  type createServiceLogger,
} from '@browshare/common'
import {
  decodeWorkerControlMessage,
  encodeWorkerControlMessage,
  isWorkerRecoveryCommand,
  WORKER_CONTROL_MAX_MESSAGE_BYTES,
  WORKER_CONTROL_PROTOCOL_MAJOR,
  WORKER_CONTROL_PROTOCOL_MINOR,
  WORKER_REQUIRED_PROBE_CHECK_NAMES,
  type WorkerControlErrorCode,
  type WorkerControlErrorMessage,
  type WorkerCapabilitiesAcceptedMessage,
  type WorkerCapabilitiesMessage,
  type WorkerCommandAcceptedMessage,
  type WorkerDiagnosticProbeCommandMessage,
  type WorkerProxyProbeCommandMessage,
  type WorkerProxyProbeResultMessage,
  type WorkerDiagnosticProbeResultMessage,
  type WorkerProfileRuntimeCommandMessage,
  type WorkerProfileRuntimeResultMessage,
  type WorkerProfileRuntimeRequest,
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
  type WorkerHelloAcceptedMessage,
  type WorkerSnapshotAcceptedMessage,
  type WorkerSnapshotMessage,
  type WorkerDownloadsAcceptedMessage,
  DownloadConsumeRequestSchema,
  DownloadCheckRequestSchema,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  workerCredentialRotations,
  workerCredentials,
  workers,
} from '@browshare/database/schema'
import { and, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

import type { BackendConfiguration } from '../configuration.js'
import type { WorkerControlLifecyclePort, WorkerControlStatus } from './workers.js'
import { SessionLeaseService } from './session-leases.js'
import { WorkerDownloadReconciler, WorkerDownloadValidationError } from './worker-downloads.js'
import { SessionDownloadService } from './session-downloads.js'
import {
  WorkerSnapshotReconciler,
  WorkerSnapshotValidationError,
} from './worker-snapshot-reconciler.js'

const WORKER_URI_PREFIX = 'URI:urn:browshare:worker:'

type ServiceLogger = ReturnType<typeof createServiceLogger>

interface AuthenticatedWorkerCertificate {
  readonly workerId: string
  readonly credentialId: string
}

class WorkerDisabledError extends Error {
  constructor() {
    super('Worker is disabled')
    this.name = 'WorkerDisabledError'
  }
}

interface WorkerConnectionState {
  controlEstablishedAtMilliseconds: number | undefined
  readonly downloadEndpoint: string | null
  capabilitiesAccepted: boolean
  capabilityReady: boolean
  readonly instanceId: string | undefined
  lastHeartbeatSequence: number
  lastSnapshotSequence: number
  negotiatedProtocolMinor: number
  readyAtMilliseconds: number | undefined
  lastHeartbeatReceivedAtMilliseconds: number | undefined
  readonly snapshotRequired: boolean
  snapshotAccepted: boolean
}

interface ActiveWorkerConnection {
  readonly credentialId: string
  readonly socket: WebSocket
  readonly state: WorkerConnectionState
}

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
  | WorkerProfileRuntimeResultMessage
  | WorkerSessionCloseResultMessage
  | WorkerSessionCreateResultMessage
  | WorkerSessionContinueResultMessage
  | WorkerSessionViewerResultMessage

interface PendingWorkerCommand {
  readonly startedAt: number
  readonly command: WorkerCommand
  readonly resolve: (result: WorkerCommandResult) => void
  readonly reject: (cause: WorkerCommandError) => void
  readonly deadlineTimer: NodeJS.Timeout
  acknowledgementTimer: NodeJS.Timeout | undefined
  attempts: number
  acknowledged: boolean
  settled: boolean
}

export type WorkerCommandErrorCode =
  | 'WORKER_UNAVAILABLE'
  | 'WORKER_PROTOCOL_INCOMPATIBLE'
  | 'WORKER_COMMAND_TIMEOUT'
  | 'WORKER_COMMAND_FAILED'
  | 'WORKER_RUNTIME_RESTARTED'

export class WorkerCommandError extends Error {
  readonly code: WorkerCommandErrorCode

  constructor(code: WorkerCommandErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options)
    this.name = 'WorkerCommandError'
    this.code = code
  }
}

export interface WorkerControlCommandPort {
  runDiagnosticProbe(workerId: string): Promise<WorkerDiagnosticProbeResultMessage>
  runProfileRuntime(
    workerId: string,
    input: WorkerProfileRuntimeRequest,
  ): Promise<WorkerProfileRuntimeResultMessage>
}

export class WorkerControlServer implements WorkerControlCommandPort, WorkerControlLifecyclePort {
  readonly #connection: DatabaseConnection
  readonly #configuration: BackendConfiguration
  readonly #logger: ServiceLogger
  readonly #snapshotReconciler: WorkerSnapshotReconciler
  readonly #sessionLeases: SessionLeaseService
  readonly #downloads: WorkerDownloadReconciler
  readonly #downloadClaims: SessionDownloadService
  readonly #storageControl: StorageControlService
  readonly #connections = new Map<string, ActiveWorkerConnection>()
  readonly #pendingCommands = new Map<string, PendingWorkerCommand>()
  readonly #commandMetrics = new CommandMetrics()
  #httpsServer: HttpsServer | undefined
  #webSocketServer: WebSocketServer | undefined
  #offlineSweepTimer: NodeJS.Timeout | undefined

  constructor(
    connection: DatabaseConnection,
    configuration: BackendConfiguration,
    logger: ServiceLogger,
    private readonly onControlStateChanged: () => void,
  ) {
    this.#connection = connection
    this.#configuration = configuration
    this.#logger = logger
    this.#snapshotReconciler = new WorkerSnapshotReconciler(connection)
    this.#sessionLeases = new SessionLeaseService(connection)
    this.#downloads = new WorkerDownloadReconciler(connection)
    this.#downloadClaims = new SessionDownloadService(connection, this)
    this.#storageControl = new StorageControlService(
      connection,
      (workerId, policy) => this.setStoragePolicy(workerId, policy),
      () => this.#logger.debug('Storage policy delivery awaits the next Worker observation'),
    )
  }

  async start(): Promise<{ readonly host: string; readonly port: number }> {
    if (this.#httpsServer !== undefined) throw new Error('Worker control server is already started')
    await this.#storageControl.start()
    const listener = this.#configuration.workerControlListener
    const controlPath = new URL(this.#configuration.workerControlUrl).pathname
    const httpsServer = createServer(
      {
        cert: listener.tlsCertificatePem,
        key: listener.tlsPrivateKeyPem,
        ca: [this.#configuration.workerCertificateAuthority.certificatePem],
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      },
      (request, response) => {
        void this.#authorizeDownloadHttp(request, response)
      },
    )
    const webSocketServer = new WebSocketServer({
      server: httpsServer,
      path: controlPath,
      maxPayload: WORKER_CONTROL_MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      clientTracking: false,
    })
    this.#httpsServer = httpsServer
    this.#webSocketServer = webSocketServer
    webSocketServer.on('connection', (socket, request) => {
      this.#handleConnection(socket, request.socket as TLSSocket)
    })
    webSocketServer.on('error', (cause) => {
      this.#logger.error({ err: cause }, 'Worker control WebSocket server failed')
    })
    httpsServer.on('tlsClientError', (cause) => {
      this.#logger.warn({ errorCode: readErrorCode(cause) }, 'Worker control TLS client rejected')
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (cause: Error) => {
          httpsServer.off('listening', onListening)
          reject(cause)
        }
        const onListening = () => {
          httpsServer.off('error', onError)
          resolve()
        }
        httpsServer.once('error', onError)
        httpsServer.once('listening', onListening)
        httpsServer.listen(listener.port, listener.host)
      })
    } catch (cause) {
      this.#httpsServer = undefined
      this.#webSocketServer = undefined
      webSocketServer.close()
      httpsServer.close()
      throw cause
    }
    const address = httpsServer.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Worker control listener has no TCP address')
    }
    this.#logger.info(
      { host: listener.host, port: address.port, path: controlPath },
      'Worker control server started',
    )
    const sweepIntervalMilliseconds = Math.min(
      listener.heartbeatIntervalMilliseconds,
      Math.max(1_000, Math.floor(listener.offlineAfterMilliseconds / 3)),
    )
    this.#offlineSweepTimer = setInterval(() => {
      void this.#runOfflineSweep()
    }, sweepIntervalMilliseconds)
    this.#offlineSweepTimer.unref()
    void this.#runOfflineSweep()
    return { host: listener.host, port: address.port }
  }

  async runDiagnosticProbe(workerId: string): Promise<WorkerDiagnosticProbeResultMessage> {
    if (!isPublicId(workerId)) throw new TypeError('Worker ID must be a UUIDv7')
    const connection = this.#connections.get(workerId)
    if (
      connection === undefined ||
      connection.socket.readyState !== WebSocket.OPEN ||
      !(
        isConnectionReady(connection.state) ||
        (connection.state.negotiatedProtocolMinor >= 20 && connection.state.capabilitiesAccepted)
      )
    ) {
      throw new WorkerCommandError(
        'WORKER_UNAVAILABLE',
        'The Worker is not connected and ready for commands.',
      )
    }
    if (connection.state.negotiatedProtocolMinor < 1) {
      throw new WorkerCommandError(
        'WORKER_PROTOCOL_INCOMPATIBLE',
        'The Worker control protocol does not support diagnostic commands.',
      )
    }

    const messageId = createPublicId()
    const deadline =
      Date.now() + this.#configuration.workerControlListener.commandResultTimeoutMilliseconds
    const command: WorkerDiagnosticProbeCommandMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'diagnostic.probe',
      messageId,
      correlationId: null,
      sentAt: Date.now(),
      payload: { workerId, expiresAt: new Date(deadline).toISOString() },
    }

    const result = await this.#requestCommand(command)
    if (result.type !== 'diagnostic.probe.result') throw new Error('Worker result type mismatch')
    return result
  }

  async setStoragePolicy(
    workerId: string,
    policy: Pick<WorkerStoragePolicyCommandMessage['payload'], 'workerPolicy' | 'profilePolicy'>,
  ): Promise<WorkerStoragePolicyResultMessage> {
    const connection = this.#connections.get(workerId)
    if (
      !connection ||
      connection.socket.readyState !== WebSocket.OPEN ||
      !isConnectionReady(connection.state)
    )
      throw new WorkerCommandError(
        'WORKER_UNAVAILABLE',
        'The Worker is not ready for storage policy delivery',
      )
    if (connection.state.negotiatedProtocolMinor < 19 || !connection.state.instanceId)
      throw new WorkerCommandError(
        'WORKER_PROTOCOL_INCOMPATIBLE',
        'Storage policies require Control 1.19',
      )
    const command: WorkerStoragePolicyCommandMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'storage.policy.set',
      messageId: createPublicId(),
      correlationId: null,
      sentAt: Date.now(),
      payload: {
        workerId,
        instanceId: connection.state.instanceId,
        ...policy,
        expiresAt: new Date(
          Date.now() + this.#configuration.workerControlListener.commandResultTimeoutMilliseconds,
        ).toISOString(),
      },
    }
    const result = await this.#requestCommand(command)
    if (result.type !== 'storage.policy.result') throw new Error('Storage command result mismatch')
    return result
  }

  async probeProxy(
    input: Omit<WorkerProxyProbeCommandMessage['payload'], 'instanceId' | 'expiresAt'>,
    commandId: string,
  ): Promise<WorkerProxyProbeResultMessage> {
    const connection = this.#connections.get(input.workerId)
    if (
      !connection ||
      connection.socket.readyState !== WebSocket.OPEN ||
      !isConnectionReady(connection.state)
    )
      throw new WorkerCommandError('WORKER_UNAVAILABLE', 'The selected Worker is not ready')
    if (connection.state.negotiatedProtocolMinor < 18 || connection.state.instanceId === undefined)
      throw new WorkerCommandError(
        'WORKER_PROTOCOL_INCOMPATIBLE',
        'Proxy probes require Worker Control 1.18',
      )
    const command: WorkerProxyProbeCommandMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'proxy.probe',
      messageId: commandId,
      correlationId: null,
      sentAt: Date.now(),
      payload: {
        ...input,
        instanceId: connection.state.instanceId,
        expiresAt: new Date(
          Date.now() + this.#configuration.workerControlListener.commandResultTimeoutMilliseconds,
        ).toISOString(),
      },
    }
    const result = await this.#requestCommand(command)
    if (result.type !== 'proxy.probe.result') throw new Error('Worker result type mismatch')
    return result
  }

  prepareProfileRuntime(
    workerId: string,
    input: WorkerProfileRuntimeRequest,
  ): WorkerProfileRuntimeCommandMessage {
    if (!isPublicId(workerId) || !isPublicId(input.profileId))
      throw new TypeError('Worker and Profile IDs must be UUIDv7')
    const connection = this.#connections.get(workerId)
    if (
      connection === undefined ||
      connection.socket.readyState !== WebSocket.OPEN ||
      !(
        isConnectionReady(connection.state) ||
        (input.action !== 'START' && isRecoveryChannel(connection.state))
      ) ||
      (input.action === 'START' && !connection.state.capabilityReady)
    )
      throw new WorkerCommandError('WORKER_UNAVAILABLE', 'The Worker Runtime is not ready')
    if (
      connection.state.negotiatedProtocolMinor <
        (input.action === 'START' ? 21 : input.action === 'DELETE' ? 10 : 3) ||
      connection.state.instanceId === undefined
    )
      throw new WorkerCommandError(
        'WORKER_PROTOCOL_INCOMPATIBLE',
        'The Worker does not support this persisted Profile Runtime operation',
      )
    const command: WorkerProfileRuntimeCommandMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'profile.runtime.set',
      messageId: createPublicId(),
      correlationId: null,
      sentAt: Date.now(),
      payload: {
        ...input,
        workerId,
        instanceId: connection.state.instanceId,
        expiresAt: new Date(
          Date.now() +
            this.#configuration.workerControlListener.profileRuntimeCommandTimeoutMilliseconds,
        ).toISOString(),
      },
    }
    return command
  }

  async dispatchProfileRuntime(
    command: WorkerProfileRuntimeCommandMessage,
  ): Promise<WorkerProfileRuntimeResultMessage> {
    // Persistence may outlive a connection; never bind a saved command to a new Worker instance.
    encodeWorkerControlMessage(command)
    const connection = this.#connections.get(command.payload.workerId)
    if (
      connection === undefined ||
      !canDispatchControlCommand(connection.state, command) ||
      connection.socket.readyState !== WebSocket.OPEN
    )
      throw new WorkerCommandError(
        'WORKER_UNAVAILABLE',
        'The Worker control connection is not ready',
      )
    if (connection.state.instanceId !== command.payload.instanceId)
      throw new WorkerCommandError(
        'WORKER_RUNTIME_RESTARTED',
        'The Worker process changed before command delivery',
      )
    if (Date.parse(command.payload.expiresAt) <= Date.now())
      throw new WorkerCommandError('WORKER_COMMAND_TIMEOUT', 'The saved Runtime command expired')
    const result = await this.#requestCommand(command)
    if (result.type !== 'profile.runtime.result') throw new Error('Worker result type mismatch')
    return result
  }

  runProfileRuntime(
    workerId: string,
    input: WorkerProfileRuntimeRequest,
  ): Promise<WorkerProfileRuntimeResultMessage> {
    return this.dispatchProfileRuntime(this.prepareProfileRuntime(workerId, input))
  }

  async dispatchSessionClose(
    command: WorkerSessionCloseCommandMessage,
  ): Promise<WorkerSessionCloseResultMessage> {
    encodeWorkerControlMessage(command)
    const connection = this.#connections.get(command.payload.workerId)
    if (
      connection === undefined ||
      !canDispatchControlCommand(connection.state, command) ||
      connection.socket.readyState !== WebSocket.OPEN
    )
      throw new WorkerCommandError(
        'WORKER_UNAVAILABLE',
        'The Worker control connection is not ready',
      )
    if (connection.state.instanceId !== command.payload.instanceId)
      throw new WorkerCommandError(
        'WORKER_RUNTIME_RESTARTED',
        'The Worker process changed before command delivery',
      )
    if (Date.parse(command.payload.expiresAt) <= Date.now())
      throw new WorkerCommandError(
        'WORKER_COMMAND_TIMEOUT',
        'The saved Session close command expired',
      )
    const result = await this.#requestCommand(command)
    if (result.type !== 'session.close.result') throw new Error('Worker result type mismatch')
    return result
  }

  async dispatchSessionCreate(
    command: WorkerSessionCreateCommandMessage,
  ): Promise<WorkerSessionCreateResultMessage> {
    encodeWorkerControlMessage(command)
    const connection = this.#connections.get(command.payload.workerId)
    if (
      !connection ||
      !isConnectionReady(connection.state) ||
      connection.socket.readyState !== WebSocket.OPEN
    )
      throw new WorkerCommandError(
        'WORKER_UNAVAILABLE',
        'The Worker control connection is not ready',
      )
    if (command.payload.kind === 'MAINTENANCE' && connection.state.negotiatedProtocolMinor < 13)
      throw new WorkerCommandError(
        'WORKER_PROTOCOL_INCOMPATIBLE',
        'Maintenance requires Worker control protocol 1.13',
      )
    if (connection.state.instanceId !== command.payload.instanceId)
      throw new WorkerCommandError(
        'WORKER_RUNTIME_RESTARTED',
        'The Worker process changed before command delivery',
      )
    if (Date.parse(command.payload.expiresAt) <= Date.now())
      throw new WorkerCommandError(
        'WORKER_COMMAND_TIMEOUT',
        'The saved Session creation command expired',
      )
    const result = await this.#requestCommand(command)
    if (result.type !== 'session.create.result') throw new Error('Worker result type mismatch')
    return result
  }

  async prepareSessionViewer(
    command: WorkerSessionViewerCommandMessage,
  ): Promise<WorkerSessionViewerResultMessage> {
    encodeWorkerControlMessage(command)
    const connection = this.#connections.get(command.payload.workerId)
    if (
      !connection ||
      !isConnectionReady(connection.state) ||
      connection.socket.readyState !== WebSocket.OPEN
    )
      throw new WorkerCommandError(
        'WORKER_UNAVAILABLE',
        'The Worker control connection is not ready',
      )
    if (connection.state.instanceId !== command.payload.instanceId)
      throw new WorkerCommandError(
        'WORKER_RUNTIME_RESTARTED',
        'The Worker process changed before Viewer preparation',
      )
    if (Date.parse(command.payload.expiresAt) <= Date.now())
      throw new WorkerCommandError('WORKER_COMMAND_TIMEOUT', 'The Viewer Ticket expired')
    const result = await this.#requestCommand(command)
    if (result.type !== 'session.viewer.result') throw new Error('Worker result type mismatch')
    return result
  }

  async continueSession(
    command: WorkerSessionContinueCommandMessage,
  ): Promise<WorkerSessionContinueResultMessage> {
    encodeWorkerControlMessage(command)
    const connection = this.#connections.get(command.payload.workerId)
    if (
      !connection ||
      !isConnectionReady(connection.state) ||
      connection.socket.readyState !== WebSocket.OPEN
    )
      throw new WorkerCommandError(
        'WORKER_UNAVAILABLE',
        'The Worker control connection is not ready',
      )
    if (connection.state.instanceId !== command.payload.instanceId)
      throw new WorkerCommandError(
        'WORKER_RUNTIME_RESTARTED',
        'The Worker process changed before Session continuation',
      )
    if (Date.parse(command.payload.expiresAt) <= Date.now())
      throw new WorkerCommandError(
        'WORKER_COMMAND_TIMEOUT',
        'The Session continuation command expired',
      )
    const result = await this.#requestCommand(command)
    if (result.type !== 'session.continue.result') throw new Error('Worker result type mismatch')
    return result
  }

  #requestCommand(command: WorkerCommand): Promise<WorkerCommandResult> {
    this.#commandMetrics.start(command.type)
    const messageId = command.messageId
    const deadline = Date.parse(command.payload.expiresAt)
    return new Promise<WorkerCommandResult>((resolve, reject) => {
      const deadlineTimer = setTimeout(
        () => {
          const pending = this.#pendingCommands.get(messageId)
          if (pending === undefined) return
          this.#rejectCommand(
            pending,
            new WorkerCommandError(
              'WORKER_COMMAND_TIMEOUT',
              pending.acknowledged
                ? 'The Worker command result timed out.'
                : 'The Worker did not acknowledge the command in time.',
            ),
          )
        },
        Math.max(1, deadline - Date.now()),
      )
      deadlineTimer.unref()
      const pending: PendingWorkerCommand = {
        startedAt: performance.now(),
        command,
        resolve,
        reject,
        deadlineTimer,
        acknowledgementTimer: undefined,
        attempts: 0,
        acknowledged: false,
        settled: false,
      }
      this.#pendingCommands.set(messageId, pending)
      this.#dispatchCommand(pending)
    })
  }

  getCommandMetrics(): string[] {
    return this.#commandMetrics.render()
  }

  getWorkerControlStatus(workerId: string): WorkerControlStatus {
    const connection = this.#connections.get(workerId)
    const connected = connection?.socket.readyState === WebSocket.OPEN
    return {
      connected,
      instanceId: connection?.state.instanceId ?? null,
      recoveryReady: connected && connection !== undefined && isRecoveryChannel(connection.state),
      protocolMinor: connected && connection ? connection.state.negotiatedProtocolMinor : null,
      credentialId: connected && connection !== undefined ? connection.credentialId : null,
      ready:
        connected &&
        connection !== undefined &&
        connection.state.capabilityReady &&
        isConnectionReady(connection.state),
    }
  }

  getDownloadEndpoint(workerId: string): { endpoint: string; instanceId: string } | undefined {
    const connection = this.#connections.get(workerId)
    if (
      !connection ||
      connection.socket.readyState !== WebSocket.OPEN ||
      !isConnectionReady(connection.state) ||
      !connection.state.capabilityReady ||
      connection.state.negotiatedProtocolMinor < 17 ||
      !connection.state.instanceId ||
      !connection.state.downloadEndpoint
    )
      return undefined
    return { endpoint: connection.state.downloadEndpoint, instanceId: connection.state.instanceId }
  }

  async #authorizeDownloadHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = createPublicId()
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('x-content-type-options', 'nosniff')
    try {
      if (
        request.method !== 'POST' ||
        !['/internal/downloads/consume', '/internal/downloads/check'].includes(request.url ?? '')
      )
        throw new BrowShareError({ code: 'NOT_FOUND', statusCode: 404, message: 'Not found.' })
      const certificate = await this.#authenticateCertificate(request.socket as TLSSocket)
      const connection = this.#connections.get(certificate.workerId)
      if (
        !connection ||
        connection.credentialId !== certificate.credentialId ||
        !this.getDownloadEndpoint(certificate.workerId)
      )
        throw new BrowShareError({
          code: 'WORKER_UNAVAILABLE',
          statusCode: 503,
          message: 'Worker is not connected.',
        })
      if (request.headers['content-type']?.split(';')[0] !== 'application/json')
        throw new BrowShareError({
          code: 'BAD_REQUEST',
          statusCode: 400,
          message: 'JSON required.',
        })
      const chunks: Buffer[] = []
      let size = 0
      request.setTimeout(5_000, () => request.destroy())
      for await (const chunk of request) {
        const bytes = chunk as Buffer
        size += bytes.length
        if (size > 1024)
          throw new BrowShareError({
            code: 'BAD_REQUEST',
            statusCode: 400,
            message: 'Request too large.',
          })
        chunks.push(bytes)
      }
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        throw new BrowShareError({ code: 'BAD_REQUEST', statusCode: 400, message: 'Invalid JSON.' })
      }
      let result
      if (
        request.url === '/internal/downloads/consume' &&
        Value.Check(DownloadConsumeRequestSchema, body) &&
        body.instanceId === connection.state.instanceId
      )
        result = await this.#downloadClaims.consume(
          certificate.workerId,
          body.instanceId,
          body.token,
        )
      else if (
        request.url === '/internal/downloads/check' &&
        Value.Check(DownloadCheckRequestSchema, body) &&
        body.instanceId === connection.state.instanceId
      )
        result = await this.#downloadClaims.check(
          certificate.workerId,
          body.instanceId,
          body.claimId,
        )
      else
        throw new BrowShareError({
          code: 'BAD_REQUEST',
          statusCode: 400,
          message: 'Invalid authorization request.',
        })
      response.end(JSON.stringify(result))
    } catch (cause) {
      const known = cause instanceof BrowShareError
      if (!known)
        this.#logger.warn({ errorCode: readErrorCode(cause) }, 'Download authorization unavailable')
      if (!response.destroyed) {
        response.statusCode = known ? cause.statusCode : 503
        response.end(
          JSON.stringify({
            error: {
              code: known ? cause.code : 'DOWNLOAD_AUTHORIZATION_FAILED',
              message: 'Download authorization failed.',
              requestId,
            },
          }),
        )
      }
    } finally {
      request.setTimeout(0)
    }
  }

  disconnectWorker(workerId: string, reason: 'DISABLED' | 'CREDENTIAL_REVOKED' | 'RETIRED'): void {
    const connection = this.#connections.get(workerId)
    if (connection !== undefined) {
      this.#connections.delete(workerId)
      this.onControlStateChanged()
      connection.socket.close(
        reason === 'DISABLED' ? 4008 : 4001,
        reason === 'DISABLED'
          ? 'Worker disabled by administrator'
          : reason === 'RETIRED'
            ? 'Worker retired by administrator'
            : 'Worker credential revoked by administrator',
      )
    }
    for (const pending of this.#pendingCommands.values()) {
      if (pending.command.payload.workerId !== workerId) continue
      this.#rejectCommand(
        pending,
        new WorkerCommandError(
          'WORKER_UNAVAILABLE',
          reason === 'CREDENTIAL_REVOKED'
            ? 'Worker credential is revoked.'
            : `Worker is ${reason.toLowerCase()}.`,
        ),
      )
    }
  }

  async close(): Promise<void> {
    const webSocketServer = this.#webSocketServer
    const httpsServer = this.#httpsServer
    this.#webSocketServer = undefined
    this.#httpsServer = undefined
    if (this.#offlineSweepTimer !== undefined) clearInterval(this.#offlineSweepTimer)
    this.#offlineSweepTimer = undefined
    for (const connection of this.#connections.values()) {
      connection.socket.close(1001, 'Backend shutting down')
      connection.socket.terminate()
    }
    this.#connections.clear()
    for (const pending of this.#pendingCommands.values()) {
      this.#rejectCommand(
        pending,
        new WorkerCommandError('WORKER_UNAVAILABLE', 'Backend is shutting down.'),
      )
    }
    await this.#storageControl.close()
    if (webSocketServer !== undefined) {
      await new Promise<void>((resolve) => webSocketServer.close(() => resolve()))
    }
    if (httpsServer !== undefined) {
      await new Promise<void>((resolve, reject) => {
        httpsServer.close((cause) => (cause === undefined ? resolve() : reject(cause)))
      })
    }
  }

  #handleConnection(socket: WebSocket, tlsSocket: TLSSocket): void {
    socket.binaryType = 'arraybuffer'
    socket.on('error', (cause) => {
      this.#logger.warn({ errorCode: readErrorCode(cause) }, 'Worker control socket failed')
    })
    const helloTimer = setTimeout(() => {
      this.#sendError(socket, null, 'HELLO_TIMEOUT', 'Worker hello was not received in time.')
      socket.close(4004, 'Worker hello timeout')
    }, this.#configuration.workerControlListener.helloTimeoutMilliseconds)
    helloTimer.unref()

    socket.once('message', (data, isBinary) => {
      void this.#handleHello(socket, data, isBinary, tlsSocket, helloTimer)
    })
  }

  async #handleHello(
    socket: WebSocket,
    data: RawData,
    isBinary: boolean,
    tlsSocket: TLSSocket,
    helloTimer: NodeJS.Timeout,
  ): Promise<void> {
    clearTimeout(helloTimer)
    let certificate: AuthenticatedWorkerCertificate
    try {
      certificate = await this.#authenticateCertificate(tlsSocket)
    } catch (cause) {
      if (cause instanceof WorkerDisabledError) {
        this.#logger.info('Disabled Worker control connection rejected')
        this.#sendError(socket, null, 'WORKER_DISABLED', 'Worker is disabled.')
        socket.close(4008, 'Worker disabled')
        return
      }
      this.#logger.warn({ errorCode: readErrorCode(cause) }, 'Worker certificate not authorized')
      this.#sendError(socket, null, 'AUTHORIZATION_FAILED', 'Worker credential is not authorized.')
      socket.close(4001, 'Worker credential not authorized')
      return
    }
    if (!isBinary) {
      this.#sendError(socket, null, 'INVALID_MESSAGE', 'Worker control messages must be binary.')
      socket.close(4002, 'Binary MessagePack required')
      return
    }

    let message
    try {
      message = decodeWorkerControlMessage(toUint8Array(data))
    } catch (cause) {
      this.#logger.warn(
        { workerId: certificate.workerId, errorCode: readErrorCode(cause) },
        'Worker hello rejected',
      )
      this.#sendError(socket, null, 'INVALID_MESSAGE', 'Worker hello is invalid.')
      socket.close(4002, 'Invalid Worker hello')
      return
    }
    if (message.protocolMajor !== WORKER_CONTROL_PROTOCOL_MAJOR) {
      this.#sendError(
        socket,
        message.messageId,
        'PROTOCOL_MISMATCH',
        'Worker control protocol major version is not supported.',
      )
      socket.close(4003, 'Protocol major mismatch')
      return
    }
    if (message.type !== 'worker.hello') {
      this.#sendError(
        socket,
        message.messageId,
        'INVALID_MESSAGE',
        'First message must be worker.hello.',
      )
      socket.close(4002, 'Worker hello required')
      return
    }
    if (
      message.payload.workerId !== certificate.workerId ||
      message.payload.credentialId !== certificate.credentialId
    ) {
      this.#sendError(
        socket,
        message.messageId,
        'AUTHORIZATION_FAILED',
        'Worker hello identity does not match the client certificate.',
      )
      socket.close(4001, 'Worker identity mismatch')
      return
    }

    const negotiatedProtocolMinor = Math.min(message.protocolMinor, WORKER_CONTROL_PROTOCOL_MINOR)
    let downloadEndpoint: string | null = null
    if (message.payload.downloadEndpoint !== undefined) {
      try {
        const endpoint = new URL(message.payload.downloadEndpoint)
        if (
          negotiatedProtocolMinor < 17 ||
          endpoint.protocol !== 'https:' ||
          endpoint.username ||
          endpoint.password ||
          endpoint.search ||
          endpoint.hash
        )
          throw new Error('Invalid endpoint')
        downloadEndpoint = endpoint.href
      } catch {
        this.#sendError(
          socket,
          message.messageId,
          'INVALID_MESSAGE',
          'Download endpoint must be an HTTPS URL without credentials, query or fragment.',
        )
        socket.close(4002, 'Invalid download endpoint')
        return
      }
    }
    const snapshotRequired = negotiatedProtocolMinor >= 1
    if (
      snapshotRequired &&
      (message.payload.instanceId === undefined || !isPublicId(message.payload.instanceId))
    ) {
      this.#sendError(
        socket,
        message.messageId,
        'INVALID_MESSAGE',
        'Worker instance ID is required by this protocol version.',
      )
      socket.close(4002, 'Worker instance ID required')
      return
    }

    const acceptedWorkers = await this.#connection.db
      .update(workers)
      .set({
        reportedHostname: message.payload.hostname,
        platform: message.payload.platform,
        architecture: message.payload.architecture,
        versions: { worker: message.payload.workerVersion },
        status: sql`case when ${workers.status} = 'ONLINE' then 'OFFLINE'::worker_status else ${workers.status} end`,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(workers.id, certificate.workerId),
          ne(workers.status, 'DISABLED'),
          isNull(workers.deletedAt),
        ),
      )
      .returning({ id: workers.id })
    if (acceptedWorkers.length === 0) {
      this.#sendError(socket, message.messageId, 'WORKER_DISABLED', 'Worker is disabled.')
      socket.close(4008, 'Worker disabled')
      return
    }

    await this.#activateRotatedCredential(
      certificate.workerId,
      certificate.credentialId,
      message.messageId,
    )

    const previous = this.#connections.get(certificate.workerId)
    if (previous !== undefined && previous.socket !== socket) {
      this.#sendError(
        previous.socket,
        null,
        'REPLACED',
        'A newer Worker connection replaced this one.',
      )
      previous.socket.close(4012, 'Replaced by newer Worker connection')
    }
    const connectionState: WorkerConnectionState = {
      controlEstablishedAtMilliseconds: undefined,
      downloadEndpoint,
      capabilitiesAccepted: false,
      capabilityReady: false,
      instanceId: message.payload.instanceId,
      lastHeartbeatSequence: 0,
      lastSnapshotSequence: 0,
      negotiatedProtocolMinor,
      readyAtMilliseconds: undefined,
      lastHeartbeatReceivedAtMilliseconds: undefined,
      snapshotRequired,
      snapshotAccepted: !snapshotRequired,
    }
    this.#connections.set(certificate.workerId, {
      credentialId: certificate.credentialId,
      socket,
      state: connectionState,
    })
    this.onControlStateChanged()
    socket.once('close', () => {
      if (this.#connections.get(certificate.workerId)?.socket === socket) {
        this.#connections.delete(certificate.workerId)
        this.onControlStateChanged()
        this.#suspendPendingCommands(certificate.workerId)
      }
    })
    let messageQueue = Promise.resolve()
    socket.on('message', (data, isBinary) => {
      messageQueue = messageQueue
        .then(() => this.#handleWorkerMessage(socket, data, isBinary, certificate, connectionState))
        .catch((cause: unknown) => {
          this.#logger.error(
            { workerId: certificate.workerId, errorCode: readErrorCode(cause) },
            'Worker control message handling failed',
          )
          socket.close(1011, 'Worker control processing failed')
        })
    })

    const accepted: WorkerHelloAcceptedMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: negotiatedProtocolMinor,
      type: 'worker.hello.accepted',
      messageId: createPublicId(),
      correlationId: message.messageId,
      sentAt: Date.now(),
      payload: {
        workerId: certificate.workerId,
        serverTime: new Date().toISOString(),
        negotiatedProtocolMinor,
        heartbeatIntervalMilliseconds:
          this.#configuration.workerControlListener.heartbeatIntervalMilliseconds,
        snapshotRequired,
      },
    }
    socket.send(encodeWorkerControlMessage(accepted), { binary: true })
    this.#logger.info(
      {
        workerId: certificate.workerId,
        credentialId: certificate.credentialId,
        protocolMinor: accepted.payload.negotiatedProtocolMinor,
      },
      'Worker control handshake accepted',
    )
  }

  async #handleWorkerMessage(
    socket: WebSocket,
    data: RawData,
    isBinary: boolean,
    certificate: AuthenticatedWorkerCertificate,
    state: WorkerConnectionState,
  ): Promise<void> {
    if (socket.readyState !== WebSocket.OPEN) return
    if (!isBinary) {
      this.#sendError(socket, null, 'INVALID_MESSAGE', 'Worker control messages must be binary.')
      socket.close(4002, 'Binary MessagePack required')
      return
    }
    let message
    try {
      message = decodeWorkerControlMessage(toUint8Array(data))
    } catch (cause) {
      this.#logger.warn(
        { workerId: certificate.workerId, errorCode: readErrorCode(cause) },
        'Worker control message rejected',
      )
      this.#sendError(socket, null, 'INVALID_MESSAGE', 'Worker control message is invalid.')
      socket.close(4002, 'Invalid Worker control message')
      return
    }
    if (message.protocolMajor !== WORKER_CONTROL_PROTOCOL_MAJOR) {
      this.#sendError(
        socket,
        message.messageId,
        'PROTOCOL_MISMATCH',
        'Worker control protocol major version is not supported.',
      )
      socket.close(4003, 'Protocol major mismatch')
      return
    }
    if (!state.capabilitiesAccepted) {
      if (message.type !== 'worker.capabilities') {
        this.#sendError(
          socket,
          message.messageId,
          'INVALID_MESSAGE',
          'Worker capability report is required after hello.',
        )
        socket.close(4002, 'Worker capability report required')
        return
      }
      await this.#acceptCapabilities(socket, certificate, state, message)
      return
    }
    if (
      !state.snapshotAccepted &&
      state.readyAtMilliseconds === undefined &&
      state.negotiatedProtocolMinor < 20
    ) {
      if (message.type !== 'worker.snapshot') {
        this.#sendError(
          socket,
          message.messageId,
          'INVALID_MESSAGE',
          'Worker runtime snapshot is required after capabilities.',
        )
        socket.close(4002, 'Worker runtime snapshot required')
        return
      }
      await this.#acceptSnapshot(socket, certificate, state, message)
      return
    }
    if (message.type === 'worker.snapshot') {
      await this.#acceptSnapshot(socket, certificate, state, message)
      return
    }
    if (message.type === 'worker.downloads') {
      if (
        state.negotiatedProtocolMinor < 16 ||
        message.payload.workerId !== certificate.workerId ||
        message.payload.instanceId !== state.instanceId ||
        this.#connections.get(certificate.workerId)?.socket !== socket
      ) {
        this.#sendError(
          socket,
          message.messageId,
          'INVALID_MESSAGE',
          'Download report identity is invalid.',
        )
        socket.close(4002, 'Invalid download report identity')
        return
      }
      let terminalIds: string[]
      try {
        terminalIds = await this.#downloads.reconcile(
          certificate.workerId,
          message.payload.downloads,
        )
      } catch (cause) {
        if (!(cause instanceof WorkerDownloadValidationError)) throw cause
        this.#sendError(
          socket,
          message.messageId,
          'INVALID_MESSAGE',
          'Download metadata is inconsistent.',
        )
        socket.close(4002, 'Invalid download metadata')
        return
      }
      const accepted: WorkerDownloadsAcceptedMessage = {
        protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
        protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
        type: 'worker.downloads.accepted',
        messageId: createPublicId(),
        correlationId: message.messageId,
        sentAt: Date.now(),
        payload: {
          workerId: certificate.workerId,
          instanceId: message.payload.instanceId,
          terminalIds,
        },
      }
      if (socket.readyState === WebSocket.OPEN)
        socket.send(encodeWorkerControlMessage(accepted), { binary: true })
      return
    }
    if (message.type === 'worker.heartbeat') {
      await this.#acceptHeartbeat(socket, certificate, state, message)
      return
    }
    if (message.type === 'worker.command.accepted') {
      this.#acceptCommandAcknowledgement(socket, certificate, message)
      return
    }
    if (message.type === 'storage.policy.result') {
      const pending = this.#pendingCommands.get(message.correlationId)
      if (!pending) return
      if (
        pending.command.type !== 'storage.policy.set' ||
        message.payload.workerId !== certificate.workerId ||
        pending.command.payload.workerId !== certificate.workerId ||
        message.payload.instanceId !== state.instanceId ||
        pending.command.payload.instanceId !== state.instanceId ||
        message.payload.storage.appliedPolicyVersion <
          pending.command.payload.workerPolicy.version ||
        (message.payload.storage.appliedPolicyVersion ===
          pending.command.payload.workerPolicy.version &&
          message.payload.storage.quotaBytes !== pending.command.payload.workerPolicy.quotaBytes) ||
        (pending.command.payload.profilePolicy
          ? message.payload.profileUsage?.profileId !==
              pending.command.payload.profilePolicy.profileId ||
            message.payload.profileUsage.appliedPolicyVersion <
              pending.command.payload.profilePolicy.version ||
            (message.payload.profileUsage.appliedPolicyVersion ===
              pending.command.payload.profilePolicy.version &&
              message.payload.profileUsage.quotaBytes !==
                pending.command.payload.profilePolicy.quotaBytes)
          : message.payload.profileUsage !== null)
      ) {
        socket.close(4002, 'Invalid storage policy result')
        return
      }
      this.#resolveCommand(pending, message)
      return
    }
    if (message.type === 'proxy.probe.result') {
      this.#acceptProxyProbeResult(socket, certificate, message)
      return
    }
    if (message.type === 'profile.runtime.result') {
      this.#acceptProfileRuntimeResult(socket, certificate, message)
      return
    }
    if (message.type === 'session.close.result') {
      this.#acceptSessionCloseResult(socket, certificate, message)
      return
    }
    if (message.type === 'session.create.result') {
      this.#acceptSessionCreateResult(socket, certificate, message)
      return
    }
    if (message.type === 'session.continue.result') {
      this.#acceptSessionCreateResult(socket, certificate, message)
      return
    }
    if (message.type === 'session.viewer.result') {
      this.#acceptSessionCreateResult(socket, certificate, message)
      return
    }
    if (message.type === 'diagnostic.probe.result') {
      await this.#acceptDiagnosticProbeResult(socket, certificate, state, message)
      return
    }
    if (message.type === 'protocol.error' && message.correlationId !== null) {
      this.#acceptCommandProtocolError(certificate, message)
      return
    }
    this.#sendError(
      socket,
      message.messageId,
      'INVALID_MESSAGE',
      'Message type is not accepted here.',
    )
    socket.close(4002, 'Unexpected Worker control message')
  }

  async #acceptCapabilities(
    socket: WebSocket,
    certificate: AuthenticatedWorkerCertificate,
    state: WorkerConnectionState,
    message: WorkerCapabilitiesMessage,
  ): Promise<void> {
    if (message.payload.workerId !== certificate.workerId) {
      this.#sendError(
        socket,
        message.messageId,
        'AUTHORIZATION_FAILED',
        'Worker capability identity does not match the client certificate.',
      )
      socket.close(4001, 'Worker capability identity mismatch')
      return
    }
    const report = message.payload.report
    if (!isValidCapabilityReport(report)) {
      this.#sendError(
        socket,
        message.messageId,
        'INVALID_MESSAGE',
        'Worker capability report contains inconsistent values.',
      )
      socket.close(4002, 'Invalid Worker capability report')
      return
    }
    const firstFailure = report.checks.find((check) => check.status !== 'PASS')
    await this.#storeCapabilityReport(certificate.workerId, report, !state.snapshotRequired)
    const wasReady = this.getWorkerControlStatus(certificate.workerId).ready
    state.capabilitiesAccepted = true
    state.controlEstablishedAtMilliseconds ??= Date.now()
    state.capabilityReady = report.status === 'READY'
    if (state.snapshotAccepted) state.readyAtMilliseconds = Date.now()
    if (wasReady !== this.getWorkerControlStatus(certificate.workerId).ready)
      this.onControlStateChanged()
    const accepted: WorkerCapabilitiesAcceptedMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'worker.capabilities.accepted',
      messageId: createPublicId(),
      correlationId: message.messageId,
      sentAt: Date.now(),
      payload: {
        workerId: certificate.workerId,
        acceptedAt: new Date().toISOString(),
        workerReady: report.status === 'READY',
      },
    }
    socket.send(encodeWorkerControlMessage(accepted), { binary: true })
    if (state.snapshotAccepted || state.negotiatedProtocolMinor >= 20)
      this.#resumePendingCommands(certificate.workerId)
    this.#logger.info(
      {
        workerId: certificate.workerId,
        probeStatus: report.status,
        probeErrorCode: firstFailure?.code ?? undefined,
      },
      'Worker capability report accepted',
    )
  }

  async #acceptSnapshot(
    socket: WebSocket,
    certificate: AuthenticatedWorkerCertificate,
    state: WorkerConnectionState,
    message: WorkerSnapshotMessage,
  ): Promise<void> {
    const snapshot = message.payload.snapshot
    if (
      !state.snapshotRequired ||
      state.instanceId === undefined ||
      message.payload.workerId !== certificate.workerId ||
      snapshot.instanceId !== state.instanceId ||
      snapshot.sequence <= state.lastSnapshotSequence
    ) {
      this.#sendError(
        socket,
        message.messageId,
        'INVALID_MESSAGE',
        'Worker runtime snapshot identity or sequence is invalid.',
      )
      socket.close(4002, 'Invalid Worker runtime snapshot')
      return
    }

    let plan
    try {
      plan = await this.#snapshotReconciler.reconcile(certificate.workerId, snapshot)
    } catch (cause) {
      if (!(cause instanceof WorkerSnapshotValidationError)) throw cause
      this.#sendError(socket, message.messageId, 'INVALID_MESSAGE', cause.message)
      socket.close(4002, 'Inconsistent Worker runtime snapshot')
      return
    }
    const wasReady = this.getWorkerControlStatus(certificate.workerId).ready
    state.lastSnapshotSequence = snapshot.sequence
    state.snapshotAccepted = !plan.resnapshotRequired
    if (state.snapshotAccepted) state.readyAtMilliseconds ??= Date.now()
    await this.#connection.db
      .update(workers)
      .set({
        status:
          state.snapshotAccepted && state.capabilityReady
            ? sql`case when ${workers.status} in ('PENDING', 'OFFLINE') then 'ONLINE'::worker_status else ${workers.status} end`
            : sql`case when ${workers.status} = 'ONLINE' then 'PENDING'::worker_status else ${workers.status} end`,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(workers.id, certificate.workerId))
    if (snapshot.storage)
      await this.#storageControl.observe(certificate.workerId, snapshot.storage, [
        ...(snapshot.profileStorageUsage ?? []),
        ...snapshot.profiles.flatMap((fact) => (fact.storageUsage ? [fact.storageUsage] : [])),
      ])
    if (wasReady !== this.getWorkerControlStatus(certificate.workerId).ready)
      this.onControlStateChanged()
    const accepted: WorkerSnapshotAcceptedMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: state.negotiatedProtocolMinor,
      type: 'worker.snapshot.accepted',
      messageId: createPublicId(),
      correlationId: message.messageId,
      sentAt: Date.now(),
      payload: {
        workerId: certificate.workerId,
        instanceId: snapshot.instanceId,
        sequence: snapshot.sequence,
        acceptedAt: new Date().toISOString(),
        ...plan,
        ...(state.negotiatedProtocolMinor >= 7 && state.capabilityReady
          ? {
              leases: await this.#sessionLeases.grant(
                certificate.workerId,
                snapshot,
                new Set(plan.closeSessions.map((action) => action.sessionId)),
              ),
            }
          : {}),
      },
    }
    socket.send(encodeWorkerControlMessage(accepted), { binary: true })
    if (state.snapshotAccepted || state.negotiatedProtocolMinor >= 20)
      this.#resumePendingCommands(certificate.workerId)
    this.#logger.info(
      {
        workerId: certificate.workerId,
        workerInstanceId: snapshot.instanceId,
        snapshotSequence: snapshot.sequence,
        profileRuntimeCount: snapshot.profiles.length,
        sessionRuntimeCount: snapshot.sessions.length,
        closeSessionCount: plan.closeSessions.length,
        stopProfileCount: plan.stopProfiles.length,
        reconciliationComplete: state.snapshotAccepted,
      },
      'Worker runtime snapshot reconciled',
    )
  }

  async #acceptHeartbeat(
    socket: WebSocket,
    certificate: AuthenticatedWorkerCertificate,
    state: WorkerConnectionState,
    message: WorkerHeartbeatMessage,
  ): Promise<void> {
    if (
      message.payload.workerId !== certificate.workerId ||
      message.payload.sequence <= state.lastHeartbeatSequence ||
      !isValidRuntimeMetrics(message.payload.metrics)
    ) {
      this.#sendError(
        socket,
        message.messageId,
        'INVALID_MESSAGE',
        'Worker heartbeat identity or sequence is invalid.',
      )
      socket.close(4002, 'Invalid Worker heartbeat')
      return
    }
    if (message.payload.storage)
      await this.#storageControl.observe(
        certificate.workerId,
        message.payload.storage,
        message.payload.profileStorageUsage ?? [],
      )
    state.lastHeartbeatSequence = message.payload.sequence
    state.lastHeartbeatReceivedAtMilliseconds = Date.now()
    const receivedAt = new Date().toISOString()
    await this.#connection.db
      .update(workers)
      .set({
        metricsSnapshot: {
          observedAt: message.payload.observedAt,
          receivedAt,
          metrics: message.payload.metrics,
        },
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(workers.id, certificate.workerId))
    const acknowledgement: WorkerHeartbeatAcknowledgedMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'worker.heartbeat.ack',
      messageId: createPublicId(),
      correlationId: message.messageId,
      sentAt: Date.now(),
      payload: {
        workerId: certificate.workerId,
        sequence: message.payload.sequence,
        receivedAt,
      },
    }
    socket.send(encodeWorkerControlMessage(acknowledgement), { binary: true })
  }

  #dispatchCommand(pending: PendingWorkerCommand): void {
    if (pending.settled || pending.acknowledged) return
    const connection = this.#connections.get(pending.command.payload.workerId)
    if (
      connection === undefined ||
      connection.socket.readyState !== WebSocket.OPEN ||
      !canDispatchControlCommand(connection.state, pending.command)
    ) {
      return
    }
    if (
      connection.state.negotiatedProtocolMinor <
      (pending.command.type === 'storage.policy.set' || pending.command.type === 'session.create'
        ? 19
        : pending.command.type === 'proxy.probe'
          ? 18
          : pending.command.type === 'session.continue'
            ? 8
            : pending.command.type === 'session.viewer.prepare'
              ? 6
              : pending.command.type === 'session.close'
                ? ['ADMIN_REQUESTED', 'PASSWORD_RESET'].includes(pending.command.payload.reason)
                  ? 11
                  : pending.command.payload.reason === 'USER_REQUESTED'
                    ? 4
                    : 9
                : pending.command.type === 'profile.runtime.set'
                  ? pending.command.payload.action === 'START'
                    ? 21
                    : pending.command.payload.action === 'DELETE'
                      ? 10
                      : 2
                  : 1)
    ) {
      this.#rejectCommand(
        pending,
        new WorkerCommandError(
          'WORKER_PROTOCOL_INCOMPATIBLE',
          'The reconnected Worker no longer supports this command.',
        ),
      )
      return
    }
    if (pending.attempts >= this.#configuration.workerControlListener.commandMaximumAttempts) {
      this.#rejectCommand(
        pending,
        new WorkerCommandError(
          'WORKER_COMMAND_TIMEOUT',
          'The Worker did not acknowledge the command.',
        ),
      )
      return
    }

    if (pending.command.type !== 'diagnostic.probe') {
      if (pending.command.payload.instanceId !== connection.state.instanceId) {
        this.#rejectCommand(
          pending,
          new WorkerCommandError(
            'WORKER_RUNTIME_RESTARTED',
            'The Worker restarted before the Runtime command completed',
          ),
        )
        return
      }
      if (
        pending.command.type === 'profile.runtime.set' &&
        pending.command.payload.action === 'START' &&
        !connection.state.capabilityReady
      ) {
        this.#rejectCommand(
          pending,
          new WorkerCommandError('WORKER_UNAVAILABLE', 'The Worker Runtime is not ready'),
        )
        return
      }
    }
    pending.attempts += 1
    this.#commandMetrics.attempt(pending.command.type)
    this.#logger.info(
      {
        workerId: pending.command.payload.workerId,
        commandId: pending.command.messageId,
        commandType: pending.command.type,
        commandAttempt: pending.attempts,
      },
      'Worker command dispatched',
    )
    connection.socket.send(
      encodeWorkerControlMessage(pending.command),
      { binary: true },
      (cause) => {
        if (
          cause != null &&
          this.#connections.get(pending.command.payload.workerId)?.socket === connection.socket
        ) {
          connection.socket.close(1011, 'Worker command send failed')
        }
      },
    )
    if (pending.acknowledgementTimer !== undefined) {
      clearTimeout(pending.acknowledgementTimer)
    }
    pending.acknowledgementTimer = setTimeout(() => {
      pending.acknowledgementTimer = undefined
      if (pending.settled || pending.acknowledged) return
      this.#dispatchCommand(pending)
    }, this.#configuration.workerControlListener.commandAcknowledgementTimeoutMilliseconds)
    pending.acknowledgementTimer.unref()
  }

  #acceptCommandAcknowledgement(
    socket: WebSocket,
    certificate: AuthenticatedWorkerCertificate,
    message: WorkerCommandAcceptedMessage,
  ): void {
    const pending = this.#pendingCommands.get(message.correlationId)
    if (pending === undefined) {
      this.#logger.debug(
        { workerId: certificate.workerId, commandId: message.correlationId },
        'Late or duplicate Worker command acknowledgement ignored',
      )
      return
    }
    if (
      message.payload.workerId !== certificate.workerId ||
      pending.command.payload.workerId !== certificate.workerId ||
      message.payload.commandType !== pending.command.type
    ) {
      this.#sendError(
        socket,
        message.messageId,
        'AUTHORIZATION_FAILED',
        'Worker command acknowledgement identity does not match.',
      )
      socket.close(4001, 'Worker command acknowledgement mismatch')
      return
    }
    pending.acknowledged = true
    if (pending.acknowledgementTimer !== undefined) {
      clearTimeout(pending.acknowledgementTimer)
      pending.acknowledgementTimer = undefined
    }
  }

  async #acceptDiagnosticProbeResult(
    socket: WebSocket,
    certificate: AuthenticatedWorkerCertificate,
    state: WorkerConnectionState,
    message: WorkerDiagnosticProbeResultMessage,
  ): Promise<void> {
    const pending = this.#pendingCommands.get(message.correlationId)
    if (pending === undefined) {
      this.#logger.debug(
        { workerId: certificate.workerId, commandId: message.correlationId },
        'Late or duplicate Worker diagnostic result ignored',
      )
      return
    }
    if (
      message.payload.workerId !== certificate.workerId ||
      pending.command.payload.workerId !== certificate.workerId ||
      pending.command.type !== 'diagnostic.probe' ||
      !isValidDiagnosticResult(message)
    ) {
      this.#sendError(
        socket,
        message.messageId,
        'INVALID_MESSAGE',
        'Worker diagnostic result is inconsistent.',
      )
      socket.close(4002, 'Invalid Worker diagnostic result')
      return
    }
    if (message.payload.outcome === 'FAILED') {
      this.#rejectCommand(
        pending,
        new WorkerCommandError(
          'WORKER_COMMAND_FAILED',
          message.payload.error?.message ?? 'The Worker diagnostic command failed.',
        ),
      )
      return
    }
    state.capabilityReady = message.payload.report!.status === 'READY'
    await this.#storeCapabilityReport(certificate.workerId, message.payload.report!, true)
    this.#logger.info(
      {
        workerId: certificate.workerId,
        commandId: message.correlationId,
        commandType: 'diagnostic.probe',
        commandOutcome: message.payload.outcome,
      },
      'Worker command result accepted',
    )
    this.#resolveCommand(pending, message)
  }

  #acceptProxyProbeResult(
    socket: WebSocket,
    certificate: AuthenticatedWorkerCertificate,
    message: WorkerProxyProbeResultMessage,
  ): void {
    const pending = this.#pendingCommands.get(message.correlationId)
    if (!pending) return
    const command = pending.command,
      result = message.payload
    const valid =
      command.type === 'proxy.probe' &&
      result.workerId === certificate.workerId &&
      command.payload.workerId === certificate.workerId &&
      result.instanceId === command.payload.instanceId &&
      result.proxyId === command.payload.proxyId &&
      result.configurationVersion === command.payload.configurationVersion &&
      result.mode === command.payload.mode &&
      (result.exitIp === null || isIP(result.exitIp) !== 0) &&
      (result.mode === 'exit-ip' && result.status === 'HEALTHY'
        ? result.exitIp !== null
        : result.exitIp === null) &&
      (result.status === 'HEALTHY' ? result.errorCode === null : result.errorCode !== null)
    if (!valid) {
      this.#sendError(
        socket,
        message.messageId,
        'INVALID_MESSAGE',
        'Worker Proxy probe result is inconsistent',
      )
      socket.close(4002, 'Invalid Proxy probe result')
      return
    }
    this.#resolveCommand(pending, message)
  }

  #acceptProfileRuntimeResult(
    socket: WebSocket,
    certificate: AuthenticatedWorkerCertificate,
    message: WorkerProfileRuntimeResultMessage,
  ): void {
    const pending = this.#pendingCommands.get(message.correlationId)
    if (pending === undefined) return
    const command = pending.command
    const result = message.payload
    const fact = result.runtime
    const valid =
      command.type === 'profile.runtime.set' &&
      result.workerId === certificate.workerId &&
      command.payload.workerId === certificate.workerId &&
      result.instanceId === command.payload.instanceId &&
      result.profileId === command.payload.profileId &&
      result.generation === command.payload.generation &&
      result.action === command.payload.action &&
      (result.outcome === 'FAILED'
        ? result.error !== null && fact === null
        : result.error === null &&
          (result.action !== 'START'
            ? fact === null
            : fact !== null &&
              fact.profileId === result.profileId &&
              fact.generation === result.generation &&
              fact.runtimeId === command.messageId &&
              (command.payload.action !== 'START' ||
                command.protocolMinor < 18 ||
                (fact.routeVersion === command.payload.routeVersion &&
                  fact.proxyHealth?.status === 'HEALTHY')) &&
              fact.state === 'RUNNING' &&
              fact.chromeProcessId !== null))
    if (!valid) {
      this.#sendError(
        socket,
        message.messageId,
        'INVALID_MESSAGE',
        'Worker Runtime result identity or state is inconsistent',
      )
      socket.close(4002, 'Invalid Worker Runtime result')
      return
    }
    this.#logger.info(
      {
        workerId: certificate.workerId,
        commandId: message.correlationId,
        commandType: command.type,
        profileId: result.profileId,
        commandOutcome: result.outcome,
      },
      'Worker command result accepted',
    )
    this.#resolveCommand(pending, message)
  }

  #acceptSessionCreateResult(
    socket: WebSocket,
    certificate: AuthenticatedWorkerCertificate,
    message:
      | WorkerSessionCreateResultMessage
      | WorkerSessionViewerResultMessage
      | WorkerSessionContinueResultMessage,
  ): void {
    const pending = this.#pendingCommands.get(message.correlationId)
    if (!pending) return
    const command = pending.command
    const result = message.payload
    const fact = result.fact
    if (
      (command.type !== 'session.create' &&
        command.type !== 'session.viewer.prepare' &&
        command.type !== 'session.continue') ||
      (command.type === 'session.create'
        ? message.type !== 'session.create.result'
        : command.type === 'session.continue'
          ? message.type !== 'session.continue.result'
          : message.type !== 'session.viewer.result') ||
      result.workerId !== certificate.workerId ||
      command.payload.workerId !== certificate.workerId ||
      result.instanceId !== command.payload.instanceId ||
      result.sessionId !== command.payload.sessionId ||
      result.profileId !== command.payload.profileId ||
      result.runtimeId !== command.payload.runtimeId ||
      result.profileGeneration !== command.payload.profileGeneration ||
      (result.outcome === 'SUCCEEDED') !== (result.error === null && fact !== null) ||
      (result.outcome === 'FAILED' && (fact !== null || result.error === null)) ||
      (fact !== null &&
        (fact.sessionId !== result.sessionId ||
          fact.profileId !== result.profileId ||
          fact.runtimeId !== result.runtimeId ||
          fact.profileGeneration !== result.profileGeneration ||
          fact.tabId === null ||
          fact.targetId === null ||
          (command.type === 'session.create'
            ? fact.status !== 'READY' ||
              fact.viewerGeneration !== 0 ||
              Date.parse(fact.leaseExpiresAt ?? '') !== Date.parse(command.payload.leaseExpiresAt)
            : !['READY', 'CONNECTED', 'SUSPENDED', 'DISCONNECTED'].includes(fact.status) ||
              fact.viewerGeneration !==
                (command.type === 'session.continue'
                  ? command.payload.viewerGeneration
                  : command.payload.ticket.claims.viewerGeneration))))
    ) {
      this.#sendError(
        socket,
        message.messageId,
        'INVALID_MESSAGE',
        'Session create result identity or state is inconsistent',
      )
      socket.close(4002, 'Invalid Session create result')
      return
    }
    this.#resolveCommand(pending, message)
  }

  #acceptSessionCloseResult(
    socket: WebSocket,
    certificate: AuthenticatedWorkerCertificate,
    message: WorkerSessionCloseResultMessage,
  ): void {
    const pending = this.#pendingCommands.get(message.correlationId)
    if (pending === undefined) return
    const command = pending.command
    const result = message.payload
    if (
      command.type !== 'session.close' ||
      result.workerId !== certificate.workerId ||
      command.payload.workerId !== certificate.workerId ||
      result.instanceId !== command.payload.instanceId ||
      result.sessionId !== command.payload.sessionId ||
      result.profileId !== command.payload.profileId ||
      result.runtimeId !== command.payload.runtimeId ||
      result.profileGeneration !== command.payload.profileGeneration ||
      (result.outcome === 'SUCCEEDED') !== (result.error === null)
    ) {
      this.#sendError(
        socket,
        message.messageId,
        'INVALID_MESSAGE',
        'Session close result identity or state is inconsistent',
      )
      socket.close(4002, 'Invalid Session close result')
      return
    }
    this.#resolveCommand(pending, message)
  }

  #acceptCommandProtocolError(
    certificate: AuthenticatedWorkerCertificate,
    message: WorkerControlErrorMessage,
  ): void {
    const pending = this.#pendingCommands.get(message.correlationId!)
    if (pending === undefined || pending.command.payload.workerId !== certificate.workerId) return
    this.#rejectCommand(
      pending,
      new WorkerCommandError('WORKER_COMMAND_FAILED', message.payload.message),
    )
  }

  #suspendPendingCommands(workerId: string): void {
    for (const pending of this.#pendingCommands.values()) {
      if (pending.command.payload.workerId !== workerId || pending.settled) continue
      pending.acknowledged = false
      if (pending.acknowledgementTimer !== undefined) {
        clearTimeout(pending.acknowledgementTimer)
        pending.acknowledgementTimer = undefined
      }
    }
  }

  #resumePendingCommands(workerId: string): void {
    for (const pending of this.#pendingCommands.values()) {
      if (pending.command.payload.workerId === workerId) {
        this.#dispatchCommand(pending)
      }
    }
  }

  #resolveCommand(pending: PendingWorkerCommand, result: WorkerCommandResult): void {
    if (pending.settled) return
    pending.settled = true
    this.#commandMetrics.complete(
      pending.command.type,
      'outcome' in result.payload && result.payload.outcome === 'FAILED' ? 'failed' : 'succeeded',
      performance.now() - pending.startedAt,
    )
    this.#clearCommandTimers(pending)
    this.#pendingCommands.delete(pending.command.messageId)
    pending.resolve(result)
  }

  #rejectCommand(pending: PendingWorkerCommand, cause: WorkerCommandError): void {
    if (pending.settled) return
    pending.settled = true
    this.#commandMetrics.complete(
      pending.command.type,
      cause.code === 'WORKER_COMMAND_TIMEOUT'
        ? 'timeout'
        : cause.code === 'WORKER_UNAVAILABLE'
          ? 'unavailable'
          : cause.code === 'WORKER_PROTOCOL_INCOMPATIBLE'
            ? 'incompatible'
            : cause.code === 'WORKER_RUNTIME_RESTARTED'
              ? 'restarted'
              : 'failed',
      performance.now() - pending.startedAt,
    )
    this.#clearCommandTimers(pending)
    this.#pendingCommands.delete(pending.command.messageId)
    pending.reject(cause)
  }

  #clearCommandTimers(pending: PendingWorkerCommand): void {
    clearTimeout(pending.deadlineTimer)
    if (pending.acknowledgementTimer !== undefined) {
      clearTimeout(pending.acknowledgementTimer)
      pending.acknowledgementTimer = undefined
    }
  }

  async #storeCapabilityReport(
    workerId: string,
    report: WorkerCapabilitiesMessage['payload']['report'],
    allowOnline: boolean,
  ): Promise<void> {
    const firstFailure = report.checks.find((check) => check.status !== 'PASS')
    await this.#connection.db
      .update(workers)
      .set({
        reportedHostname: report.host.hostname,
        platform: report.host.platform,
        architecture: report.host.architecture,
        capabilities: report,
        versions: report.versions,
        lastProbeErrorCode: firstFailure?.code ?? null,
        lastProbeErrorSummary: firstFailure?.summary ?? null,
        status:
          report.status === 'READY'
            ? allowOnline
              ? sql`case when ${workers.status} in ('PENDING', 'OFFLINE') then 'ONLINE'::worker_status else ${workers.status} end`
              : sql`case when ${workers.status} = 'ONLINE' then 'OFFLINE'::worker_status else ${workers.status} end`
            : sql`case when ${workers.status} = 'ONLINE' then 'PENDING'::worker_status else ${workers.status} end`,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(workers.id, workerId))
  }

  async #runOfflineSweep(): Promise<void> {
    try {
      await this.#sweepOfflineWorkers()
    } catch (cause) {
      this.#logger.error({ errorCode: readErrorCode(cause) }, 'Worker offline-state sweep failed')
    }
  }

  async #sweepOfflineWorkers(): Promise<void> {
    const cutoffMilliseconds =
      Date.now() - this.#configuration.workerControlListener.offlineAfterMilliseconds
    const cutoff = new Date(cutoffMilliseconds).toISOString()

    const connectedCredentialIds = [...this.#connections.values()].map(
      (connection) => connection.credentialId,
    )
    if (connectedCredentialIds.length > 0) {
      await this.#connection.db
        .update(workerCredentials)
        .set({ status: 'EXPIRED' })
        .where(
          and(
            inArray(workerCredentials.id, connectedCredentialIds),
            eq(workerCredentials.status, 'ACTIVE'),
            lte(workerCredentials.expiresAt, sql`now()`),
          ),
        )
      const authorizedCredentials = await this.#connection.db
        .select({ id: workerCredentials.id })
        .from(workerCredentials)
        .where(
          and(
            inArray(workerCredentials.id, connectedCredentialIds),
            eq(workerCredentials.status, 'ACTIVE'),
            gt(workerCredentials.expiresAt, sql`now()`),
          ),
        )
      const authorizedCredentialIds = new Set(authorizedCredentials.map(({ id }) => id))
      for (const [workerId, connection] of this.#connections) {
        if (authorizedCredentialIds.has(connection.credentialId)) continue
        this.#connections.delete(workerId)
        this.onControlStateChanged()
        this.#suspendPendingCommands(workerId)
        connection.socket.close(4001, 'Worker credential no longer active')
        await this.#connection.db
          .update(workers)
          .set({
            status: sql`case when ${workers.status} = 'ONLINE' then 'OFFLINE'::worker_status else ${workers.status} end`,
            updatedAt: sql`now()`,
          })
          .where(eq(workers.id, workerId))
        this.#logger.warn(
          { workerId, credentialId: connection.credentialId },
          'Worker control connection closed because its credential is no longer active',
        )
      }
    }

    for (const [workerId, connection] of this.#connections) {
      if (
        !connection.state.capabilitiesAccepted ||
        (connection.state.negotiatedProtocolMinor < 20 &&
          connection.state.readyAtMilliseconds === undefined)
      )
        continue
      const heartbeatReference =
        connection.state.lastHeartbeatReceivedAtMilliseconds ??
        connection.state.controlEstablishedAtMilliseconds
      if (heartbeatReference === undefined || heartbeatReference > cutoffMilliseconds) continue
      this.#connections.delete(workerId)
      this.onControlStateChanged()
      this.#suspendPendingCommands(workerId)
      connection.socket.close(4005, 'Worker heartbeat expired')
      this.#logger.warn({ workerId }, 'Worker control connection expired without heartbeat')
    }

    const staleWorkers = await this.#connection.db
      .select({ id: workers.id })
      .from(workers)
      .where(
        and(
          eq(workers.status, 'ONLINE'),
          isNull(workers.deletedAt),
          lte(workers.lastSeenAt, cutoff),
        ),
      )
    for (const staleWorker of staleWorkers) {
      const liveConnection = this.#connections.get(staleWorker.id)
      const liveReference =
        liveConnection?.state.lastHeartbeatReceivedAtMilliseconds ??
        liveConnection?.state.readyAtMilliseconds ??
        liveConnection?.state.controlEstablishedAtMilliseconds
      if (liveReference !== undefined && liveReference > cutoffMilliseconds) continue
      const updated = await this.#connection.db
        .update(workers)
        .set({ status: 'OFFLINE', updatedAt: sql`now()` })
        .where(
          and(
            eq(workers.id, staleWorker.id),
            eq(workers.status, 'ONLINE'),
            lte(workers.lastSeenAt, cutoff),
          ),
        )
        .returning({ id: workers.id })
      if (updated.length > 0) {
        this.#logger.warn(
          { workerId: staleWorker.id },
          'Worker marked offline after heartbeat expiry',
        )
      }
    }
  }

  async #activateRotatedCredential(
    workerId: string,
    credentialId: string,
    requestId: string,
  ): Promise<void> {
    await this.#connection.db.transaction(async (transaction) => {
      const [rotation] = await transaction
        .select({
          createdByUserId: workerCredentialRotations.createdByUserId,
          replacesCredentialId: workerCredentialRotations.replacesCredentialId,
        })
        .from(workerCredentialRotations)
        .where(
          and(
            eq(workerCredentialRotations.workerId, workerId),
            eq(workerCredentialRotations.issuedCredentialId, credentialId),
            eq(workerCredentialRotations.status, 'CONSUMED'),
          ),
        )
        .limit(1)
      if (rotation === undefined) return

      const revoked = await transaction
        .update(workerCredentials)
        .set({ status: 'REVOKED', revokedAt: sql`now()`, revokeReason: 'rotated' })
        .where(
          and(
            eq(workerCredentials.id, rotation.replacesCredentialId),
            eq(workerCredentials.workerId, workerId),
            eq(workerCredentials.status, 'ACTIVE'),
          ),
        )
        .returning({ id: workerCredentials.id })
      if (revoked.length === 0) return

      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: rotation.createdByUserId,
        action: 'worker.credential.rotate',
        targetType: 'worker',
        targetId: workerId,
        result: 'SUCCEEDED',
        requestId,
        changes: {
          replacedCredentialId: rotation.replacesCredentialId,
          credentialId,
        },
        metadata: {},
      })
    })
  }

  async #authenticateCertificate(tlsSocket: TLSSocket): Promise<AuthenticatedWorkerCertificate> {
    if (!tlsSocket.authorized) throw new Error('TLS client certificate is not authorized')
    const peer = tlsSocket.getPeerCertificate(true)
    if (peer.raw === undefined || peer.raw.byteLength === 0) {
      throw new Error('TLS client certificate is missing')
    }
    const certificate = new X509Certificate(peer.raw)
    const subjectAlternativeName = certificate.subjectAltName
    if (
      subjectAlternativeName === undefined ||
      !subjectAlternativeName.startsWith(WORKER_URI_PREFIX)
    ) {
      throw new Error('TLS client certificate Worker URI is missing')
    }
    const workerId = subjectAlternativeName.slice(WORKER_URI_PREFIX.length)
    if (!isPublicId(workerId)) throw new Error('TLS client certificate Worker URI is invalid')
    const [credential] = await this.#connection.db
      .select({
        workerId: workerCredentials.workerId,
        credentialId: workerCredentials.id,
        workerStatus: workers.status,
      })
      .from(workerCredentials)
      .innerJoin(workers, eq(workers.id, workerCredentials.workerId))
      .where(
        and(
          eq(workerCredentials.workerId, workerId),
          eq(workerCredentials.certificateSerial, certificate.serialNumber),
          eq(workerCredentials.fingerprintSha256, certificate.fingerprint256),
          eq(workerCredentials.status, 'ACTIVE'),
          lte(workerCredentials.notBefore, sql`now()`),
          gt(workerCredentials.expiresAt, sql`now()`),
          isNull(workers.deletedAt),
        ),
      )
      .limit(1)
    if (credential === undefined) throw new Error('Worker credential is not active')
    if (credential.workerStatus === 'DISABLED') throw new WorkerDisabledError()
    return credential
  }

  #sendError(
    socket: WebSocket,
    correlationId: string | null,
    code: WorkerControlErrorCode,
    message: string,
  ): void {
    if (socket.readyState !== WebSocket.OPEN) return
    const error: WorkerControlErrorMessage = {
      protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
      protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
      type: 'protocol.error',
      messageId: createPublicId(),
      correlationId,
      sentAt: Date.now(),
      payload: { code, message },
    }
    socket.send(encodeWorkerControlMessage(error), { binary: true })
  }
}

function isValidCapabilityReport(report: WorkerCapabilitiesMessage['payload']['report']): boolean {
  const names = new Set(report.checks.map((check) => check.name))
  if (
    names.size !== report.checks.length ||
    WORKER_REQUIRED_PROBE_CHECK_NAMES.some((name) => !names.has(name))
  ) {
    return false
  }
  const allPassed = report.checks.every((check) => check.status === 'PASS')
  if ((report.status === 'READY') !== allPassed) return false
  return isValidStorageSnapshots(report.storage)
}

function isConnectionReady(state: WorkerConnectionState): boolean {
  return state.capabilitiesAccepted && state.snapshotAccepted
}

function isValidRuntimeMetrics(metrics: WorkerHeartbeatMessage['payload']['metrics']): boolean {
  if (metrics.memory.availableBytes > metrics.memory.totalBytes) return false
  return isValidStorageSnapshots(metrics.storage)
}

function isValidDiagnosticResult(message: WorkerDiagnosticProbeResultMessage): boolean {
  if (message.payload.outcome === 'SUCCEEDED') {
    return (
      message.payload.report !== null &&
      message.payload.error === null &&
      isValidCapabilityReport(message.payload.report)
    )
  }
  return message.payload.report === null && message.payload.error !== null
}

function isValidStorageSnapshots(
  snapshots: WorkerHeartbeatMessage['payload']['metrics']['storage'],
): boolean {
  const purposes = new Set(snapshots.map((snapshot) => snapshot.purpose))
  if (purposes.size !== snapshots.length) return false
  return snapshots.every(
    (snapshot) =>
      snapshot.availableBytes <= snapshot.totalBytes &&
      (snapshot.totalInodes === null ||
        (snapshot.availableInodes !== null && snapshot.availableInodes <= snapshot.totalInodes)) &&
      (snapshot.totalInodes !== null || snapshot.availableInodes === null),
  )
}

function toUint8Array(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return Buffer.concat(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function readErrorCode(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined
  return typeof cause.code === 'string' ? cause.code : undefined
}

function isRecoveryChannel(state: WorkerConnectionState): boolean {
  return (
    state.negotiatedProtocolMinor >= 20 &&
    state.capabilitiesAccepted &&
    state.lastSnapshotSequence > 0
  )
}
function canDispatchControlCommand(state: WorkerConnectionState, command: WorkerCommand): boolean {
  if (isConnectionReady(state)) return true
  if (state.negotiatedProtocolMinor < 20 || !state.capabilitiesAccepted) return false
  return (
    command.type === 'diagnostic.probe' ||
    (isRecoveryChannel(state) && isWorkerRecoveryCommand(command))
  )
}
