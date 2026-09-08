import type {
  WorkerSessionCloseCommandMessage,
  WorkerSessionRuntimeFact,
  WorkerSessionCreateCommandMessage,
  WorkerSessionViewerCommandMessage,
  WorkerSessionContinueCommandMessage,
} from '@browshare/contracts'
import {
  WorkerSessionError,
  type CreateWorkerTabSession,
  type WorkerTabSessionAuthorization,
  type SessionViewerTicket,
} from './tab-sessions.js'
import { createSessionNavigationAuthorizer } from './session-navigation.js'

export interface SessionCommandPort {
  continueTabSession(sessionId: string, viewerGeneration: number): WorkerSessionRuntimeFact
  prepareSessionViewerTicket(ticket: SessionViewerTicket): Promise<WorkerSessionRuntimeFact>
  readRuntimeFacts(): Promise<{ sessions: WorkerSessionRuntimeFact[] }>
  closeTabSession(sessionId: string, reason: string, creationExpiresAt?: string): Promise<void>
  createTabSession(
    request: CreateWorkerTabSession,
    authorization: WorkerTabSessionAuthorization,
  ): Promise<WorkerSessionRuntimeFact>
}

export async function executeSessionViewer(
  runtime: SessionCommandPort,
  command: WorkerSessionViewerCommandMessage,
) {
  const input = command.payload
  const fact = (await runtime.readRuntimeFacts()).sessions.find(
    (session) => session.sessionId === input.sessionId,
  )
  if (
    !fact ||
    fact.profileId !== input.profileId ||
    fact.runtimeId !== input.runtimeId ||
    fact.profileGeneration !== input.profileGeneration ||
    input.ticket.claims.sessionId !== input.sessionId
  )
    throw new WorkerSessionError(
      'SESSION_MAPPING_CONFLICT',
      'Viewer command does not match the current Session',
    )
  return runtime.prepareSessionViewerTicket(input.ticket)
}

export async function executeSessionContinue(
  runtime: SessionCommandPort,
  command: WorkerSessionContinueCommandMessage,
) {
  const input = command.payload
  const fact = (await runtime.readRuntimeFacts()).sessions.find(
    (session) => session.sessionId === input.sessionId,
  )
  if (
    !fact ||
    fact.profileId !== input.profileId ||
    fact.runtimeId !== input.runtimeId ||
    fact.profileGeneration !== input.profileGeneration
  )
    throw new WorkerSessionError(
      'SESSION_MAPPING_CONFLICT',
      'Viewer command does not match the current Session',
    )
  return runtime.continueTabSession(input.sessionId, input.viewerGeneration)
}

export function executeSessionCreate(
  runtime: SessionCommandPort,
  command: WorkerSessionCreateCommandMessage,
): Promise<WorkerSessionRuntimeFact> {
  const input = command.payload
  if (input.policy === undefined || input.createdAt === undefined)
    throw new WorkerSessionError(
      'SESSION_POLICY_REQUIRED',
      'Session creation requires a policy snapshot',
    )
  if (input.transferSettings === undefined)
    throw new WorkerSessionError(
      'SESSION_TRANSFER_POLICY_REQUIRED',
      'Session creation requires a transfer policy snapshot',
    )
  if (input.qualityPolicy === undefined)
    throw new WorkerSessionError(
      'SESSION_MEDIA_POLICY_REQUIRED',
      'Session creation requires a media policy snapshot',
    )
  if (input.navigationPolicy?.policyScript != null && input.navigationUser === undefined)
    throw new WorkerSessionError(
      'NAVIGATION_CONTEXT_REQUIRED',
      'Policy Script requires the authenticated navigation context',
    )
  const endpoint = new URL(input.signaling.endpoint)
  if (
    endpoint.protocol !== 'wss:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new WorkerSessionError(
      'SESSION_GATEWAY_INVALID',
      'Session Gateway requires a WSS endpoint',
    )
  return runtime.createTabSession(
    {
      kind: input.kind ?? 'NORMAL',
      messageId: command.messageId,
      ...(input.workerStoragePolicy === undefined
        ? {}
        : { workerStoragePolicy: input.workerStoragePolicy }),
      ...(input.profileStoragePolicy === undefined
        ? {}
        : { profileStoragePolicy: input.profileStoragePolicy }),
      sessionId: input.sessionId,
      profileId: input.profileId,
      runtimeId: input.runtimeId,
      profileGeneration: input.profileGeneration,
      reservationExpiresAt: input.expiresAt,
      leaseExpiresAt: input.leaseExpiresAt,
      createdAt: input.createdAt,
      policy: input.policy,
      qualityPolicy: input.qualityPolicy,
      transferSettings: input.transferSettings,
      initialUrl: input.initialUrl,
      capabilities: input.capabilities,
      signaling: input.signaling,
      ...(input.pageScript === null
        ? {}
        : {
            pageScript: {
              versionId: input.pageScript.versionId,
              source: input.pageScript.source,
              ...(input.pageScript.context === undefined
                ? {}
                : { context: input.pageScript.context }),
            },
          }),
    },
    {
      // Maintenance is explicitly authorized by the control plane and can bootstrap a Profile
      // before any normal navigation publication exists. It still uses the HTTP(S) URL compiler.
      authorizeNavigation: createSessionNavigationAuthorizer(
        input.navigationPolicy ?? {
          rules: [],
          defaultAction: 'ALLOW_REMOTE',
          policyScript: null,
        },
        {
          user: input.navigationUser ?? null,
          session: { id: input.sessionId, profileId: input.profileId },
        },
      ),
      async issueViewerTicket() {
        throw new WorkerSessionError(
          'VIEWER_TICKET_UNAVAILABLE',
          'Viewer connection command has not been provided',
        )
      },
    },
  )
}

export async function executeSessionClose(
  runtime: SessionCommandPort,
  command: WorkerSessionCloseCommandMessage,
): Promise<void> {
  const input = command.payload
  const fact = (await runtime.readRuntimeFacts()).sessions.find(
    (session) => session.sessionId === input.sessionId,
  )
  if (
    fact !== undefined &&
    (fact.profileId !== input.profileId ||
      fact.runtimeId !== input.runtimeId ||
      fact.profileGeneration !== input.profileGeneration)
  )
    throw new WorkerSessionError(
      'SESSION_MAPPING_CONFLICT',
      'The command targets another Session runtime',
    )
  await runtime.closeTabSession(input.sessionId, input.reason, input.creationExpiresAt)
  if (
    (await runtime.readRuntimeFacts()).sessions.some(
      (session) => session.sessionId === input.sessionId,
    )
  )
    throw new WorkerSessionError('SESSION_CLEANUP_INCOMPLETE', 'Session cleanup has not completed')
}
