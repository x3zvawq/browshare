import { createHash, timingSafeEqual } from 'node:crypto'
import { BrowShareError } from '@browshare/common'
import {
  GatewayCapabilitiesSchema,
  GatewayHealthSchema,
  type GatewayCoreAuthorizationRequest,
  type GatewayViewerClaims,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  permissions,
  profiles,
  rolePermissions,
  roles,
  tabSessions,
  userRoles,
  users,
  viewerTickets,
} from '@browshare/database/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { Value } from 'typebox/value'
import type { GatewayConfiguration } from '../gateway-configuration.js'
import { profileAccessCondition } from './profile-access.js'

type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]
const CONNECTABLE = ['READY', 'CONNECTED', 'SUSPENDED', 'DISCONNECTED']

export class GatewayService {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly gateways: readonly GatewayConfiguration[],
  ) {}

  assigned(id: string): GatewayConfiguration {
    const gateway = this.gateways.find((entry) => entry.id === id)
    if (!gateway)
      throw new BrowShareError({
        code: 'GATEWAY_UNAVAILABLE',
        message: 'The assigned Gateway is not configured.',
        statusCode: 503,
      })
    return gateway
  }

  authenticate(gatewayId: string, authorization: string | undefined): GatewayConfiguration {
    const gateway = this.gateways.find((entry) => entry.id === gatewayId)
    if (!gateway || !authorization?.startsWith('Bearer ')) throw unauthorized()
    const supplied = Buffer.from(authorization.slice(7)),
      expected = Buffer.from(gateway.secret)
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected))
      throw unauthorized()
    return gateway
  }

  async ready(): Promise<void> {
    await this.connection.db.execute(sql`select 1`)
  }

  async select(): Promise<GatewayConfiguration> {
    for (const gateway of this.gateways) {
      try {
        const response = await fetch(gateway.healthUrl, {
          headers: { authorization: 'Bearer ' + gateway.secret },
          redirect: 'error',
          signal: AbortSignal.timeout(3000),
        })
        if (!response.ok) {
          await response.body?.cancel()
          continue
        }
        const health: unknown = await response.json()
        if (
          Value.Check(GatewayHealthSchema, health) &&
          health.ready &&
          health.gatewayId === gateway.id
        )
          return gateway
      } catch {
        /* A configured but unavailable Gateway cannot accept new Sessions. */
      }
    }
    throw new BrowShareError({
      code: 'GATEWAY_UNAVAILABLE',
      message: 'No configured Gateway is ready.',
      statusCode: 503,
    })
  }

  async consumeTicket(gatewayId: string, token: string): Promise<{ claims: GatewayViewerClaims }> {
    return this.connection.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock_shared(28691, 1)`)
      const [located] = await tx
        .select({
          sessionId: viewerTickets.sessionId,
          userId: viewerTickets.userId,
          profileId: tabSessions.profileId,
        })
        .from(viewerTickets)
        .innerJoin(tabSessions, eq(tabSessions.id, viewerTickets.sessionId))
        .where(
          and(eq(viewerTickets.tokenDigest, digest(token)), eq(viewerTickets.gatewayId, gatewayId)),
        )
      if (!located) throw unauthorized()
      await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, located.profileId))
        .for('update')
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, located.userId))
        .for('update')
      const [session] = await tx
        .select()
        .from(tabSessions)
        .where(eq(tabSessions.id, located.sessionId))
        .for('update')
      const [ticket] = await tx
        .select()
        .from(viewerTickets)
        .where(
          and(eq(viewerTickets.tokenDigest, digest(token)), eq(viewerTickets.gatewayId, gatewayId)),
        )
        .for('update')
      const [clock] = await tx.execute<{ now: string }>(sql`select clock_timestamp() as now`)
      const now = clock!.now
      if (
        !ticket ||
        !session ||
        ticket.status !== 'ACTIVE' ||
        Date.parse(ticket.expiresAt) <= Date.parse(now!) ||
        ticket.userId !== session.userId ||
        ticket.generation !== session.viewerGeneration ||
        ticket.generation < 1 ||
        session.gatewayId !== gatewayId ||
        !CONNECTABLE.includes(session.status) ||
        session.leaseExpiresAt === null ||
        Date.parse(session.leaseExpiresAt) <= Date.parse(now!) ||
        !(await authorized(tx, session.userId, session.profileId, session.kind))
      )
        throw unauthorized()
      const allowed = ticket.capabilities.allowed
      if (!Value.Check(GatewayCapabilitiesSchema, allowed))
        throw new Error('Stored Viewer Ticket capabilities are invalid')
      const claims: GatewayViewerClaims = {
        sessionId: session.id,
        viewerGeneration: ticket.generation,
        gatewayId,
        capabilities: allowed,
        issuedAt: Math.floor(Date.parse(ticket.createdAt) / 1000),
        expiresAt: Math.floor(Date.parse(ticket.expiresAt) / 1000),
        jti: ticket.id,
        issuer: 'browshare',
        audience: 'remote-tab-viewer',
      }
      if (claims.expiresAt <= Math.floor(Date.parse(now) / 1000)) throw unauthorized()
      await tx
        .update(viewerTickets)
        .set({ status: 'CONSUMED', consumedAt: sql`clock_timestamp()` })
        .where(eq(viewerTickets.id, ticket.id))
      return { claims }
    })
  }

  async authorizeCore(gatewayId: string, input: GatewayCoreAuthorizationRequest): Promise<boolean> {
    if (input.gatewayId !== gatewayId) return false
    const [session] = await this.connection.db
      .select()
      .from(tabSessions)
      .where(
        and(
          eq(tabSessions.id, input.sessionId),
          eq(tabSessions.gatewayId, gatewayId),
          eq(tabSessions.coreBindingTokenDigest, digest(input.bindingToken)),
          eq(tabSessions.viewerGeneration, input.viewerGeneration),
          sql`${tabSessions.leaseExpiresAt} > clock_timestamp()`,
        ),
      )
    if (!session || !CONNECTABLE.includes(session.status)) return false
    return authorized(this.connection.db, session.userId, session.profileId, session.kind)
  }
}

export async function authorized(
  db: Pick<Transaction, 'select'>,
  userId: string,
  profileId: string,
  kind: 'NORMAL' | 'MAINTENANCE' = 'NORMAL',
): Promise<boolean> {
  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.id, profileId),
        kind === 'NORMAL'
          ? profileAccessCondition(userId)
          : and(
              isNull(profiles.deletedAt),
              isNull(profiles.deleteRequestedAt),
              eq(profiles.businessStatus, 'ENABLED'),
              sql`exists (select 1 from ${users} where ${users.id}=${userId} and ${users.status}='ENABLED' and ${users.deletedAt} is null)`,
            ),
      ),
    )
  if (!profile) return false
  const [permission] = await db
    .select({ id: permissions.id })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        eq(userRoles.userId, userId),
        isNull(roles.deletedAt),
        eq(permissions.code, kind === 'MAINTENANCE' ? 'profile.maintain' : 'session.use'),
      ),
    )
    .limit(1)
  return permission !== undefined
}
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
function unauthorized(): BrowShareError {
  return new BrowShareError({
    code: 'UNAUTHORIZED',
    message: 'Gateway authorization failed.',
    statusCode: 401,
  })
}
