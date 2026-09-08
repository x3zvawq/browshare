import { readViewerFocusPolicy } from './system-settings.js'
import { createHash, randomBytes } from 'node:crypto'
import { BrowShareError, createPublicId, isPublicId } from '@browshare/common'
import {
  GatewayCapabilitiesSchema,
  ViewerFocusPolicySchema,
  WORKER_CONTROL_PROTOCOL_MAJOR,
  WORKER_CONTROL_PROTOCOL_MINOR,
  type SessionContinueRequest,
  type SessionContinueResponse,
  type WorkerSessionContinueCommandMessage,
  type SessionViewerRequest,
  type SessionViewerLaunch,
  type SessionViewerTicket,
  type WorkerSessionViewerCommandMessage,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { auditEvents, profiles, tabSessions, viewerTickets } from '@browshare/database/schema'
import { and, eq, sql } from 'drizzle-orm'
import { Value } from 'typebox/value'
import type { GatewayService } from './gateways.js'
import { lockAuthorizedSession } from './session-authorization.js'
import { appendSessionEvent } from './session-events.js'
import { WorkerCommandError, type WorkerControlServer } from './worker-control-server.js'

const CONNECTABLE = ['READY', 'CONNECTED', 'SUSPENDED', 'DISCONNECTED']

export class SessionViewerService {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: Pick<WorkerControlServer, 'prepareSessionViewer' | 'continueSession'>,
    private readonly gateways: Pick<GatewayService, 'assigned'>,
  ) {}

  async connect(
    userId: string,
    sessionId: string,
    input: SessionViewerRequest,
    requestId?: string,
  ): Promise<SessionViewerLaunch> {
    if (!isPublicId(sessionId)) throw error('BAD_REQUEST', 'Session ID must be UUIDv7.', 400)
    const prepared = await this.connection.db.transaction(async (tx) => {
      const session = await lockAuthorizedSession(tx, userId, sessionId)
      if (
        !CONNECTABLE.includes(session.status) ||
        !session.gatewayId ||
        !session.runtimeId ||
        !session.workerInstanceId ||
        session.profileGeneration === null
      )
        throw error('SESSION_NOT_READY', 'The Session cannot accept a Viewer.', 409)
      const [clock] = await tx.execute<{ now: string }>(sql`select clock_timestamp() as now`)
      const issuedAt = Math.floor(Date.parse(clock!.now) / 1000)
      if (!session.leaseExpiresAt || Date.parse(session.leaseExpiresAt) <= Date.parse(clock!.now))
        throw error('SESSION_LEASE_EXPIRED', 'The Session lease expired.', 409)
      if (
        session.activeViewerClientId !== null &&
        session.activeViewerClientId !== input.clientId &&
        input.takeoverGeneration !== session.viewerGeneration
      )
        throw new BrowShareError({
          code: 'VIEWER_TAKEOVER_REQUIRED',
          message: 'Confirm replacing the current Viewer.',
          statusCode: 409,
          details: {
            viewerGeneration: session.viewerGeneration,
            connectedAt:
              session.viewerConnectedAt === null
                ? null
                : new Date(session.viewerConnectedAt).toISOString(),
          },
        })
      if (session.viewerGeneration >= 2147483647)
        throw error('VIEWER_GENERATION_EXHAUSTED', 'Create a new Session to continue.', 409)
      const [profile] = await tx
        .select({ policy: profiles.viewerFocusPolicy })
        .from(profiles)
        .where(eq(profiles.id, session.profileId))
      if (!profile) throw new Error('Session Profile is missing.')
      const focusPolicy = profile.policy ?? (await readViewerFocusPolicy(tx))
      if (!Value.Check(ViewerFocusPolicySchema, focusPolicy))
        throw new Error('Profile Viewer focus policy is invalid.')
      const capabilities = session.capabilities.allowed
      if (!Value.Check(GatewayCapabilitiesSchema, capabilities))
        throw error(
          'SESSION_CAPABILITIES_UNAVAILABLE',
          'The Session has no valid capability snapshot.',
          409,
        )
      const gateway = this.gateways.assigned(session.gatewayId)
      const token = randomBytes(32).toString('base64url'),
        ticketId = createPublicId()
      const generation = session.viewerGeneration + 1,
        expiresAt = new Date((issuedAt + 60) * 1000).toISOString()
      const ticket: SessionViewerTicket = {
        token,
        claims: {
          sessionId,
          viewerGeneration: generation,
          gatewayId: gateway.id,
          capabilities,
          issuedAt,
          expiresAt: issuedAt + 60,
          jti: ticketId,
          issuer: 'browshare',
          audience: 'remote-tab-viewer',
        },
      }
      await tx
        .update(viewerTickets)
        .set({
          status: 'REVOKED',
          revokedAt: sql`clock_timestamp()`,
          revokeReason: 'VIEWER_REPLACED',
        })
        .where(and(eq(viewerTickets.sessionId, sessionId), eq(viewerTickets.status, 'ACTIVE')))
      await tx.insert(viewerTickets).values({
        id: ticketId,
        sessionId,
        userId,
        gatewayId: gateway.id,
        tokenDigest: createHash('sha256').update(token).digest('hex'),
        createdAt: new Date(issuedAt * 1000).toISOString(),
        generation,
        capabilities: { allowed: capabilities },
        purpose:
          session.activeViewerClientId !== null && session.activeViewerClientId !== input.clientId
            ? 'TAKEOVER'
            : 'CONNECT',
        expiresAt,
      })
      await tx
        .update(tabSessions)
        .set({
          viewerGeneration: generation,
          activeViewerClientId: input.clientId,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(tabSessions.id, sessionId))
      await appendSessionEvent(tx, sessionId, 'session.viewer.authorized', { generation })
      const commandId = createPublicId()
      await tx.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: userId,
        action: 'session.viewer.authorize',
        targetType: 'session',
        targetId: sessionId,
        result: 'SUCCEEDED',
        metadata: { generation, commandId },
        ...(requestId === undefined ? {} : { requestId }),
      })
      const command: WorkerSessionViewerCommandMessage = {
        protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
        protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
        type: 'session.viewer.prepare',
        messageId: commandId,
        correlationId: null,
        sentAt: Date.now(),
        payload: {
          workerId: session.workerId,
          instanceId: session.workerInstanceId,
          sessionId,
          profileId: session.profileId,
          runtimeId: session.runtimeId,
          profileGeneration: session.profileGeneration,
          expiresAt,
          ticket,
        },
      }
      return {
        command,
        ticketId,
        launch: {
          sessionId,
          gatewayId: gateway.id,
          signalingUrl: gateway.publicEndpoint,
          viewerGeneration: generation,
          ticket: token,
          expiresAt,
          capabilities,
          focusPolicy,
        },
      }
    })
    try {
      const result = await this.control.prepareSessionViewer(prepared.command)
      if (result.payload.outcome !== 'SUCCEEDED')
        throw error(result.payload.error!.code, 'The Worker could not prepare the Viewer.', 503)
      await this.connection.db.transaction(async (tx) => {
        const session = await lockAuthorizedSession(tx, userId, sessionId)
        if (
          !CONNECTABLE.includes(session.status) ||
          session.viewerGeneration !== prepared.launch.viewerGeneration
        )
          throw error(
            'VIEWER_REQUEST_REPLACED',
            'A newer connection request replaced this one.',
            409,
          )
        const [ticket] = await tx
          .select()
          .from(viewerTickets)
          .where(eq(viewerTickets.id, prepared.ticketId))
          .for('update')
        const [clock] = await tx.execute<{ now: string }>(sql`select clock_timestamp() as now`)
        const fact = result.payload.fact!
        if (
          fact.tabId !== session.tabId ||
          fact.targetId !== session.targetId ||
          fact.runtimeId !== session.runtimeId ||
          fact.profileGeneration !== session.profileGeneration ||
          result.payload.instanceId !== session.workerInstanceId
        )
          throw error(
            'SESSION_RESULT_MISMATCH',
            'The prepared Viewer belongs to another runtime.',
            409,
          )
        if (!session.leaseExpiresAt || Date.parse(session.leaseExpiresAt) <= Date.parse(clock!.now))
          throw error('SESSION_LEASE_EXPIRED', 'The Session lease expired during preparation.', 409)
        if (
          !ticket ||
          ticket.status !== 'ACTIVE' ||
          Date.parse(ticket.expiresAt) <= Date.parse(clock!.now)
        )
          throw error('VIEWER_TICKET_EXPIRED', 'Request a new Viewer connection.', 409)
        await appendSessionEvent(tx, sessionId, 'session.viewer.prepared', {
          generation: session.viewerGeneration,
        })
      })
      return prepared.launch
    } catch (cause) {
      await this.connection.db
        .update(viewerTickets)
        .set({
          status: 'REVOKED',
          revokedAt: sql`clock_timestamp()`,
          revokeReason: 'VIEWER_PREPARATION_FAILED',
        })
        .where(and(eq(viewerTickets.id, prepared.ticketId), eq(viewerTickets.status, 'ACTIVE')))
      if (cause instanceof WorkerCommandError)
        throw error(cause.code, 'The Worker could not prepare the Viewer.', 503)
      throw cause
    }
  }

  async continue(
    userId: string,
    sessionId: string,
    input: SessionContinueRequest,
    requestId?: string,
  ): Promise<SessionContinueResponse> {
    if (!isPublicId(sessionId)) throw error('BAD_REQUEST', 'Session ID must be UUIDv7.', 400)
    const check = (session: typeof tabSessions.$inferSelect) => {
      if (
        !CONNECTABLE.includes(session.status) ||
        !session.runtimeId ||
        !session.workerInstanceId ||
        session.profileGeneration === null
      )
        throw error('SESSION_NOT_READY', 'The Session is not active.', 409)
      if (
        session.viewerGeneration !== input.viewerGeneration ||
        session.activeViewerClientId !== input.clientId
      )
        throw error('VIEWER_GENERATION_STALE', 'Continue from the current Viewer.', 409)
      if (!session.leaseExpiresAt || Date.parse(session.leaseExpiresAt) <= Date.now())
        throw error('SESSION_LEASE_EXPIRED', 'The Session lease expired.', 409)
    }
    const command = await this.connection.db.transaction(
      async (tx): Promise<WorkerSessionContinueCommandMessage> => {
        const session = await lockAuthorizedSession(tx, userId, sessionId)
        check(session)
        return {
          protocolMajor: WORKER_CONTROL_PROTOCOL_MAJOR,
          protocolMinor: WORKER_CONTROL_PROTOCOL_MINOR,
          type: 'session.continue',
          messageId: createPublicId(),
          correlationId: null,
          sentAt: Date.now(),
          payload: {
            workerId: session.workerId,
            instanceId: session.workerInstanceId!,
            sessionId,
            profileId: session.profileId,
            runtimeId: session.runtimeId!,
            profileGeneration: session.profileGeneration!,
            viewerGeneration: input.viewerGeneration,
            expiresAt: new Date(
              Math.min(Date.now() + 10_000, Date.parse(session.leaseExpiresAt!)),
            ).toISOString(),
          },
        }
      },
    )
    try {
      const result = await this.control.continueSession(command)
      if (result.payload.outcome !== 'SUCCEEDED')
        throw error(result.payload.error!.code, 'The Session could not be continued.', 409)
      return await this.connection.db.transaction(async (tx) => {
        const session = await lockAuthorizedSession(tx, userId, sessionId)
        check(session)
        const fact = result.payload.fact!
        if (
          fact.tabId !== session.tabId ||
          fact.targetId !== session.targetId ||
          fact.runtimeId !== session.runtimeId ||
          fact.profileGeneration !== session.profileGeneration ||
          result.payload.instanceId !== session.workerInstanceId
        )
          throw error(
            'SESSION_RESULT_MISMATCH',
            'The continuation belongs to another runtime.',
            409,
          )
        // A later snapshot may already include new input; never replace it with an older result.
        if (
          session.runtimeObservedAt === null ||
          Date.parse(session.runtimeObservedAt) <= Date.parse(result.payload.completedAt)
        )
          await tx
            .update(tabSessions)
            .set({
              recycling: fact.recycling ?? null,
              runtimeObservedAt: result.payload.completedAt,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(eq(tabSessions.id, sessionId))
        await appendSessionEvent(tx, sessionId, 'session.continued', {
          generation: input.viewerGeneration,
        })
        await tx.insert(auditEvents).values({
          id: createPublicId(),
          actorUserId: userId,
          action: 'session.continue',
          targetType: 'session',
          targetId: sessionId,
          result: 'SUCCEEDED',
          metadata: { generation: input.viewerGeneration, commandId: command.messageId },
          ...(requestId === undefined ? {} : { requestId }),
        })
        return { recycling: fact.recycling ?? null, serverTime: new Date().toISOString() }
      })
    } catch (cause) {
      if (cause instanceof WorkerCommandError)
        throw error(cause.code, 'The Worker could not continue the Session.', 503)
      throw cause
    }
  }
}

function error(code: string, message: string, statusCode: number) {
  return new BrowShareError({ code, message, statusCode })
}
