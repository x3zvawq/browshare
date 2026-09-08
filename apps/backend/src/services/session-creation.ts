import { BrowShareError } from '@browshare/common'
import {
  decodeWorkerControlMessage,
  encodeWorkerControlMessage,
  type TabSession,
  type TabSessionCreateRequest,
  type MaintenanceSessionCreateRequest,
  type WorkerSessionCreateCommandMessage,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  profiles,
  reservations,
  sessionCreateOutbox,
  tabSessions,
  workers,
} from '@browshare/database/schema'
import { and, asc, eq, notInArray, sql } from 'drizzle-orm'
import type { GatewayService } from './gateways.js'
import type { SessionReservationService } from './session-reservations.js'
import type { SessionService } from './sessions.js'
import { WorkerCommandError, type WorkerControlServer } from './worker-control-server.js'

type SavedCreate = typeof sessionCreateOutbox.$inferSelect

export class SessionCreationService {
  readonly #active = new Map<string, Promise<void>>()
  #timer: NodeJS.Timeout | undefined
  #tick: Promise<void> | undefined
  #closed = false

  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: Pick<WorkerControlServer, 'dispatchSessionCreate'>,
    private readonly reservations: SessionReservationService,
    private readonly sessions: Pick<SessionService, 'get'>,
    private readonly gateways: Pick<GatewayService, 'select'>,
    private readonly onError: (cause: unknown) => void,
  ) {}

  start(): void {
    if (this.#timer !== undefined || this.#closed) return
    this.#timer = setInterval(() => this.#schedule(), 1000)
    this.#timer.unref()
    this.#schedule()
  }
  stop(): void {
    this.#closed = true
    clearInterval(this.#timer)
  }
  async drain(): Promise<void> {
    await this.#tick
    await Promise.allSettled(this.#active.values())
  }

  async create(
    userId: string,
    input: TabSessionCreateRequest,
    requestId?: string,
  ): Promise<TabSession> {
    const gateway = await this.gateways.select()
    const { session } = await this.reservations.reserve(userId, input.profileId, requestId, {
      initialUrl: input.initialUrl,
      gateway: { id: gateway.id, publicEndpoint: gateway.publicEndpoint },
    })
    this.#schedule()
    return this.sessions.get(userId, session.id)
  }

  async createMaintenance(
    userId: string,
    profileId: string,
    input: MaintenanceSessionCreateRequest,
    requestId?: string,
  ): Promise<TabSession> {
    const gateway = await this.gateways.select()
    const { session } = await this.reservations.reserve(userId, profileId, requestId, {
      ...input,
      kind: 'MAINTENANCE',
      gateway: { id: gateway.id, publicEndpoint: gateway.publicEndpoint },
    })
    this.#schedule()
    return this.sessions.get(userId, session.id)
  }

  #schedule(): void {
    if (this.#closed || this.#tick !== undefined) return
    this.#tick = this.#dispatch()
      .catch(this.onError)
      .finally(() => {
        this.#tick = undefined
      })
  }
  async #dispatch(): Promise<void> {
    const pending = await this.connection.db
      .select()
      .from(sessionCreateOutbox)
      .orderBy(asc(sessionCreateOutbox.createdAt))
      .limit(256)
    for (const operation of pending) {
      if (this.#closed || this.#active.size >= 32) break
      if (this.#active.has(operation.id)) continue
      const run = this.#deliver(operation)
        .catch(this.onError)
        .finally(() => this.#active.delete(operation.id))
      this.#active.set(operation.id, run)
    }
  }
  async #deliver(operation: SavedCreate): Promise<void> {
    const command = decodeWorkerControlMessage(
      encodeWorkerControlMessage(operation.command as WorkerSessionCreateCommandMessage),
    )
    if (
      command.type !== 'session.create' ||
      command.messageId !== operation.id ||
      command.payload.sessionId !== operation.sessionId
    )
      throw new Error('Stored Session create identity is invalid')

    try {
      const [current] = await this.connection.db
        .select({ session: tabSessions, profile: profiles, reservation: reservations })
        .from(tabSessions)
        .innerJoin(profiles, eq(profiles.id, tabSessions.profileId))
        .innerJoin(reservations, eq(reservations.sessionId, tabSessions.id))
        .where(eq(tabSessions.id, operation.sessionId))
      if (
        !current ||
        current.reservation.status !== 'ACTIVE' ||
        !['RESERVED', 'CREATING'].includes(current.session.status)
      ) {
        await this.#remove(operation.id)
        return
      }
      if (Date.parse(operation.expiresAt) <= Date.now())
        throw new WorkerCommandError('WORKER_COMMAND_TIMEOUT', 'The Session reservation expired')
      const profile = current.profile
      if (
        profile.runtimeId !== command.payload.runtimeId ||
        profile.runtimeWorkerInstanceId !== command.payload.instanceId ||
        profile.runtimeGeneration !== command.payload.profileGeneration ||
        profile.runtimeDesiredState !== 'RUNNING'
      )
        throw new WorkerCommandError(
          'WORKER_RUNTIME_RESTARTED',
          'The reserved Profile Runtime changed',
        )
      if (profile.runtimeState === 'STARTING') return
      if (
        !(
          current.session.kind === 'MAINTENANCE' ? ['RUNNING', 'MAINTAINING'] : ['RUNNING']
        ).includes(profile.runtimeState)
      )
        throw new BrowShareError({
          code: 'PROFILE_NOT_READY',
          message: 'The Profile Runtime failed to start',
          statusCode: 409,
        })

      if (current.session.kind === 'MAINTENANCE') {
        const [other] = await this.connection.db
          .select({ id: tabSessions.id })
          .from(tabSessions)
          .where(
            and(
              eq(tabSessions.profileId, profile.id),
              sql`${tabSessions.id} <> ${current.session.id}`,
              notInArray(tabSessions.status, ['CLOSED', 'FAILED']),
            ),
          )
          .limit(1)
        if (other) return
        const [worker] = await this.connection.db
          .select({ snapshot: workers.runtimeSnapshot })
          .from(workers)
          .where(eq(workers.id, profile.workerId))
        // Terminal database status can precede cleanup of a late create. Wait for actual facts;
        // the Worker repeats this exclusivity check when it receives the command.
        const facts = worker?.snapshot?.sessions
        if (
          !Array.isArray(facts) ||
          facts.some(
            (fact) => fact.profileId === profile.id && fact.sessionId !== current.session.id,
          )
        )
          return
      }

      const begun = await this.reservations.begin(operation.id)
      if (
        begun.session.runtimeId !== command.payload.runtimeId ||
        begun.session.workerInstanceId !== command.payload.instanceId ||
        begun.session.profileGeneration !== command.payload.profileGeneration
      )
        throw new WorkerCommandError(
          'WORKER_RUNTIME_RESTARTED',
          'The reserved Profile Runtime changed',
        )
      const result = await this.control.dispatchSessionCreate(command)
      if (this.#closed) return
      if (result.payload.outcome === 'FAILED')
        await this.reservations.fail(operation.id, result.payload.error!.code)
      else
        await this.reservations.accept(
          operation.id,
          result.payload.instanceId,
          result.payload.fact!,
          result.payload.completedAt,
        )
      await this.#remove(operation.id)
    } catch (cause) {
      if (this.#closed) return
      if (
        ((cause instanceof WorkerCommandError && cause.code === 'WORKER_UNAVAILABLE') ||
          (cause instanceof BrowShareError && cause.code === 'PROFILE_MAINTENANCE_DRAINING')) &&
        Date.parse(operation.expiresAt) > Date.now()
      )
        return
      if (!(cause instanceof WorkerCommandError) && !(cause instanceof BrowShareError)) throw cause
      // A snapshot may already have consumed the reservation, or close may have overtaken create.
      // fail() only changes pending reservations; reconciliation removes any late Worker Tab.
      await this.reservations.fail(operation.id, cause.code)
      await this.#remove(operation.id)
    }
  }
  async #remove(id: string): Promise<void> {
    await this.connection.db.delete(sessionCreateOutbox).where(eq(sessionCreateOutbox.id, id))
  }
}
