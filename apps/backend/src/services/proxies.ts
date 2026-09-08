import { WorkerCommandError, type WorkerControlServer } from './worker-control-server.js'
import { lockSessionPolicyConfiguration } from './session-policy-rules.js'
import { normalizeHealthcheckUrl } from './healthcheck-url.js'
import {
  BrowShareError,
  normalizeProxyHost,
  assertProxyCredentials,
  createPublicId,
  decodePageCursor,
  encodePageCursor,
  isPublicId,
  normalizePageLimit,
} from '@browshare/common'
import type {
  CreateProxyRequest,
  ProxyProbeRequest,
  ProxyProbeResult,
  ProxyListQuery,
  ProxyListResponse,
  ProxyResponse,
  ProxyType,
  UpdateProxyRequest,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import { auditEvents, profiles, proxies, workers } from '@browshare/database/schema'
import { and, count, desc, eq, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm'

import { isPostgresUniqueViolation } from './database-errors.js'

export interface ProxyAuditContext {
  readonly actorUserId: string
  readonly requestId?: string
}

export interface ProxyReadContext {
  readonly credentialsReadable: boolean
}

export interface ProxyPort {
  list(query: ProxyListQuery, context: ProxyReadContext): Promise<ProxyListResponse>
  get(proxyId: string, context: ProxyReadContext): Promise<ProxyResponse>
  create(
    input: CreateProxyRequest,
    audit: ProxyAuditContext,
    read: ProxyReadContext,
  ): Promise<ProxyResponse>
  update(
    proxyId: string,
    input: UpdateProxyRequest,
    audit: ProxyAuditContext,
    read: ProxyReadContext,
  ): Promise<ProxyResponse>
  delete(proxyId: string, audit: ProxyAuditContext): Promise<void>
  probe(
    proxyId: string,
    input: ProxyProbeRequest,
    audit: ProxyAuditContext,
  ): Promise<ProxyProbeResult>
}

type ProxyRecord = typeof proxies.$inferSelect

interface ProxyListRecord extends ProxyRecord {
  readonly assignedProfileCount: number
}

interface NormalizedProxyConfiguration {
  readonly name: string
  readonly type: ProxyType
  readonly host: string | null
  readonly port: number | null
  readonly username: string | null
  readonly password: string | null
  readonly healthcheckUrl: string | null
}

export class ProxyService implements ProxyPort {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly control: Pick<WorkerControlServer, 'probeProxy'>,
  ) {}

  async probe(
    proxyId: string,
    input: ProxyProbeRequest,
    audit: ProxyAuditContext,
  ): Promise<ProxyProbeResult> {
    assertProxyId(proxyId)
    if (!isPublicId(input.workerId)) throw badRequest('Worker ID must be a UUIDv7.')
    const probeId = createPublicId()
    const prepared = await this.connection.db.transaction(async (tx) => {
      const [proxy] = await tx
        .select()
        .from(proxies)
        .where(and(eq(proxies.id, proxyId), isNull(proxies.deletedAt)))
        .for('update')
      if (!proxy) throw proxyNotFound()
      const [worker] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(and(eq(workers.id, input.workerId), isNull(workers.deletedAt)))
      if (!worker)
        throw new BrowShareError({
          code: 'NOT_FOUND',
          message: 'The selected Worker does not exist.',
          statusCode: 404,
        })
      const targetUrl =
        input.mode === 'health' ? proxy.healthcheckUrl : normalizeHealthcheckUrl(input.exitIpUrl)
      if (!targetUrl) throw badRequest('Configure the Proxy HTTPS health check before probing.')
      await tx.update(proxies).set({ lastProbeId: probeId }).where(eq(proxies.id, proxyId))
      return { proxy, targetUrl }
    })
    const { proxy } = prepared
    let result: ProxyProbeResult
    try {
      const response = await this.control.probeProxy(
        {
          workerId: input.workerId,
          proxyId,
          configurationVersion: proxy.configurationVersion,
          mode: input.mode,
          targetUrl: prepared.targetUrl,
          proxy:
            proxy.type === 'DIRECT'
              ? { type: 'DIRECT' }
              : {
                  type: proxy.type,
                  host: proxy.host!,
                  port: proxy.port!,
                  username: proxy.username,
                  password: proxy.password,
                },
        },
        probeId,
      )
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Control connection identity is not a REST response field.
      const { instanceId: _instanceId, ...fact } = response.payload
      result = {
        ...fact,
        lastSucceededAt: fact.status === 'HEALTHY' ? fact.checkedAt : proxy.lastSucceededAt,
      }
    } catch (cause) {
      if (cause instanceof WorkerCommandError)
        throw new BrowShareError({
          code:
            cause.code === 'WORKER_COMMAND_TIMEOUT'
              ? 'WORKER_COMMAND_TIMEOUT'
              : 'WORKER_UNAVAILABLE',
          message: cause.message,
          statusCode: cause.code === 'WORKER_COMMAND_TIMEOUT' ? 504 : 409,
          cause,
        })
      throw cause
    }
    await this.connection.db.transaction(async (tx) => {
      await tx
        .update(proxies)
        .set({
          healthStatus: result.status,
          lastCheckedAt: result.checkedAt,
          lastSucceededAt: result.lastSucceededAt,
          lastErrorSummary: result.errorCode,
          lastProbeWorkerId: input.workerId,
          lastProbeMode: input.mode,
          lastExitIp: result.exitIp,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(proxies.id, proxyId),
            isNull(proxies.deletedAt),
            eq(proxies.configurationVersion, proxy.configurationVersion),
            eq(proxies.lastProbeId, probeId),
          ),
        )
      await writeProxyAudit(tx, audit, {
        action: 'proxy.probe',
        targetId: proxyId,
        changes: {
          workerId: input.workerId,
          configurationVersion: proxy.configurationVersion,
          mode: input.mode,
          status: result.status,
          errorCode: result.errorCode,
        },
      })
    })
    return result
  }

  async list(query: ProxyListQuery, context: ProxyReadContext): Promise<ProxyListResponse> {
    const limit = normalizePageLimit(query.limit)
    const cursor = query.cursor === undefined ? undefined : decodePageCursor(query.cursor)
    const filters: SQL[] = [isNull(proxies.deletedAt)]
    if (query.search !== undefined) {
      const searchText = query.search.trim()
      if (searchText.length === 0) throw badRequest('Search must not be blank.')
      const search = `%${escapeLike(searchText)}%`
      filters.push(or(ilike(proxies.name, search), ilike(proxies.host, search))!)
    }
    if (query.type !== undefined && query.type !== 'ALL') filters.push(eq(proxies.type, query.type))
    if (query.healthStatus !== undefined && query.healthStatus !== 'ALL') {
      filters.push(eq(proxies.healthStatus, query.healthStatus))
    }
    if (cursor !== undefined) {
      filters.push(
        or(
          lt(proxies.createdAt, cursor.createdAt),
          and(eq(proxies.createdAt, cursor.createdAt), lt(proxies.id, cursor.id)),
        )!,
      )
    }

    const assignedProfileCounts = buildAssignedProfileCounts(this.connection)
    const records = await this.connection.db
      .select({
        id: proxies.id,
        name: proxies.name,
        type: proxies.type,
        host: proxies.host,
        port: proxies.port,
        username: proxies.username,
        password: proxies.password,
        healthcheckUrl: proxies.healthcheckUrl,
        healthStatus: proxies.healthStatus,
        configurationVersion: proxies.configurationVersion,
        lastProbeWorkerId: proxies.lastProbeWorkerId,
        lastProbeMode: proxies.lastProbeMode,
        lastExitIp: proxies.lastExitIp,
        lastProbeId: proxies.lastProbeId,
        lastCheckedAt: proxies.lastCheckedAt,
        lastSucceededAt: proxies.lastSucceededAt,
        lastErrorSummary: proxies.lastErrorSummary,
        deletedAt: proxies.deletedAt,
        createdAt: proxies.createdAt,
        updatedAt: proxies.updatedAt,
        assignedProfileCount: sql<number>`coalesce(${assignedProfileCounts.assignedProfileCount}, 0)::integer`,
      })
      .from(proxies)
      .leftJoin(assignedProfileCounts, eq(assignedProfileCounts.proxyId, proxies.id))
      .where(and(...filters))
      .orderBy(desc(proxies.createdAt), desc(proxies.id))
      .limit(limit + 1)

    const hasMore = records.length > limit
    const page = records.slice(0, limit)
    const last = page.at(-1)
    return {
      items: page.map((record) => toResponse(record, context)),
      meta: {
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? encodePageCursor({ id: last.id, createdAt: last.createdAt })
            : null,
      },
    }
  }

  async get(proxyId: string, context: ProxyReadContext): Promise<ProxyResponse> {
    assertProxyId(proxyId)
    const assignedProfileCounts = buildAssignedProfileCounts(this.connection)
    const [record] = await this.connection.db
      .select({
        id: proxies.id,
        name: proxies.name,
        type: proxies.type,
        host: proxies.host,
        port: proxies.port,
        username: proxies.username,
        password: proxies.password,
        healthcheckUrl: proxies.healthcheckUrl,
        healthStatus: proxies.healthStatus,
        configurationVersion: proxies.configurationVersion,
        lastProbeWorkerId: proxies.lastProbeWorkerId,
        lastProbeMode: proxies.lastProbeMode,
        lastExitIp: proxies.lastExitIp,
        lastProbeId: proxies.lastProbeId,
        lastCheckedAt: proxies.lastCheckedAt,
        lastSucceededAt: proxies.lastSucceededAt,
        lastErrorSummary: proxies.lastErrorSummary,
        deletedAt: proxies.deletedAt,
        createdAt: proxies.createdAt,
        updatedAt: proxies.updatedAt,
        assignedProfileCount: sql<number>`coalesce(${assignedProfileCounts.assignedProfileCount}, 0)::integer`,
      })
      .from(proxies)
      .leftJoin(assignedProfileCounts, eq(assignedProfileCounts.proxyId, proxies.id))
      .where(and(eq(proxies.id, proxyId), isNull(proxies.deletedAt)))
      .limit(1)
    if (record === undefined) throw proxyNotFound()
    return toResponse(record, context)
  }

  async create(
    input: CreateProxyRequest,
    audit: ProxyAuditContext,
    read: ProxyReadContext,
  ): Promise<ProxyResponse> {
    const configuration = normalizeConfiguration({
      name: input.name,
      type: input.type,
      host: input.host ?? null,
      port: input.port ?? null,
      username: input.username ?? null,
      password: input.password ?? null,
      healthcheckUrl: input.healthcheckUrl ?? null,
    })
    const proxyId = createPublicId()
    try {
      await this.connection.db.transaction(async (transaction) => {
        await transaction.insert(proxies).values({ id: proxyId, ...configuration })
        await writeProxyAudit(transaction, audit, {
          action: 'proxy.create',
          targetId: proxyId,
          changes: auditConfiguration(configuration),
        })
      })
    } catch (cause) {
      if (isPostgresUniqueViolation(cause)) throw proxyNameConflict(cause)
      throw cause
    }
    return this.get(proxyId, read)
  }

  async update(
    proxyId: string,
    input: UpdateProxyRequest,
    audit: ProxyAuditContext,
    read: ProxyReadContext,
  ): Promise<ProxyResponse> {
    assertProxyId(proxyId)
    try {
      await this.connection.db.transaction(async (transaction) => {
        await lockSessionPolicyConfiguration(transaction)
        const [current] = await transaction
          .select()
          .from(proxies)
          .where(and(eq(proxies.id, proxyId), isNull(proxies.deletedAt)))
          .for('update')
          .limit(1)
        if (current === undefined) throw proxyNotFound()

        const requestedType = input.type ?? current.type
        const direct = requestedType === 'DIRECT'
        if (
          direct &&
          ((input.host !== undefined && normalizeNullableText(input.host) !== null) ||
            (input.port !== undefined && input.port !== null) ||
            (input.username !== undefined && normalizeCredential(input.username) !== null) ||
            (input.password !== undefined && normalizeCredential(input.password) !== null))
        ) {
          throw badRequest('A DIRECT Proxy cannot contain an endpoint or credentials.')
        }
        const configuration = normalizeConfiguration({
          name: input.name ?? current.name,
          type: requestedType,
          host: direct ? null : input.host === undefined ? current.host : input.host,
          port: direct ? null : input.port === undefined ? current.port : input.port,
          username: direct
            ? null
            : input.username === undefined
              ? current.username
              : input.username,
          password: direct
            ? null
            : input.password === undefined
              ? current.password
              : input.password,
          healthcheckUrl:
            input.healthcheckUrl === undefined ? current.healthcheckUrl : input.healthcheckUrl,
        })
        const networkChanged =
          configuration.type !== current.type ||
          configuration.host !== current.host ||
          configuration.port !== current.port ||
          configuration.username !== current.username ||
          configuration.password !== current.password
        const connectionChanged =
          networkChanged || configuration.healthcheckUrl !== current.healthcheckUrl

        await transaction
          .update(proxies)
          .set({
            ...configuration,
            ...(connectionChanged
              ? {
                  configurationVersion: current.configurationVersion + 1,
                  lastProbeWorkerId: null,
                  lastProbeMode: null,
                  lastExitIp: null,
                  lastProbeId: null,
                  healthStatus: 'UNKNOWN' as const,
                  lastCheckedAt: null,
                  lastSucceededAt: null,
                  lastErrorSummary: null,
                }
              : {}),
            updatedAt: sql`now()`,
          })
          .where(eq(proxies.id, proxyId))
        if (networkChanged)
          await transaction
            .update(profiles)
            .set({
              routeVersion: sql`${profiles.routeVersion} + 1`,
              updatedAt: sql`now()`,
            })
            .where(and(eq(profiles.proxyId, proxyId), isNull(profiles.deletedAt)))
        await writeProxyAudit(transaction, audit, {
          action: 'proxy.update',
          targetId: proxyId,
          changes: {
            ...auditConfiguration(configuration),
            connectionChanged,
          },
        })
      })
    } catch (cause) {
      if (isPostgresUniqueViolation(cause)) throw proxyNameConflict(cause)
      throw cause
    }
    return this.get(proxyId, read)
  }

  async delete(proxyId: string, audit: ProxyAuditContext): Promise<void> {
    assertProxyId(proxyId)
    await this.connection.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ id: proxies.id, name: proxies.name })
        .from(proxies)
        .where(and(eq(proxies.id, proxyId), isNull(proxies.deletedAt)))
        .for('update')
        .limit(1)
      if (current === undefined) throw proxyNotFound()
      const [usage] = await transaction
        .select({ count: count() })
        .from(profiles)
        .where(and(eq(profiles.proxyId, proxyId), isNull(profiles.deletedAt)))
      if ((usage?.count ?? 0) > 0) {
        throw new BrowShareError({
          code: 'PROXY_IN_USE',
          message: 'The Proxy is still assigned to one or more Profiles.',
          statusCode: 409,
          details: { assignedProfileCount: usage?.count ?? 0 },
        })
      }
      await transaction
        .update(proxies)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(proxies.id, proxyId))
      await writeProxyAudit(transaction, audit, {
        action: 'proxy.delete',
        targetId: proxyId,
        changes: { name: current.name, deleted: true },
      })
    })
  }
}

function buildAssignedProfileCounts(connection: DatabaseConnection) {
  return connection.db
    .select({
      proxyId: profiles.proxyId,
      assignedProfileCount: count().as('assigned_profile_count'),
    })
    .from(profiles)
    .where(and(isNull(profiles.deletedAt), sql`${profiles.proxyId} is not null`))
    .groupBy(profiles.proxyId)
    .as('proxy_assigned_profile_counts')
}

function toResponse(record: ProxyListRecord, context: ProxyReadContext): ProxyResponse {
  const hasUsername = record.username !== null
  const hasPassword = record.password !== null
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    host: record.host,
    port: record.port,
    credentials: {
      readable: context.credentialsReadable,
      hasUsername,
      hasPassword,
      username: context.credentialsReadable ? record.username : null,
      password: context.credentialsReadable ? record.password : null,
    },
    healthcheckUrl: record.healthcheckUrl,
    healthStatus: record.healthStatus,
    configurationVersion: record.configurationVersion,
    lastProbeWorkerId: record.lastProbeWorkerId,
    lastProbeMode: record.lastProbeMode as 'health' | 'exit-ip' | null,
    lastExitIp: record.lastExitIp,
    lastCheckedAt: toNullableIsoTimestamp(record.lastCheckedAt),
    lastSucceededAt: toNullableIsoTimestamp(record.lastSucceededAt),
    lastErrorSummary: record.lastErrorSummary,
    assignedProfileCount: record.assignedProfileCount,
    createdAt: toIsoTimestamp(record.createdAt),
    updatedAt: toIsoTimestamp(record.updatedAt),
  }
}

function normalizeConfiguration(input: NormalizedProxyConfiguration): NormalizedProxyConfiguration {
  const name = input.name.trim()
  if (name.length === 0 || name.length > 128) {
    throw badRequest('Proxy name must contain between 1 and 128 characters.')
  }
  const healthcheckUrl = normalizeHealthcheckUrl(input.healthcheckUrl)
  if (input.type === 'DIRECT') {
    const carriesEndpoint =
      normalizeNullableText(input.host) !== null ||
      input.port !== null ||
      normalizeCredential(input.username) !== null ||
      normalizeCredential(input.password) !== null
    if (carriesEndpoint) {
      throw badRequest('A DIRECT Proxy cannot contain an endpoint or credentials.')
    }
    return {
      name,
      type: input.type,
      host: null,
      port: null,
      username: null,
      password: null,
      healthcheckUrl,
    }
  }

  if (input.host === null) throw badRequest('A network Proxy requires a host.')
  if (
    input.port === null ||
    !Number.isInteger(input.port) ||
    input.port < 1 ||
    input.port > 65_535
  ) {
    throw badRequest('A network Proxy requires a port between 1 and 65535.')
  }
  let host: string
  const username = normalizeCredential(input.username)
  const password = normalizeCredential(input.password)
  try {
    host = normalizeProxyHost(input.host)
    assertProxyCredentials(input.type, username, password)
  } catch (cause) {
    if (cause instanceof TypeError) throw badRequest(cause.message)
    throw cause
  }
  return {
    name,
    type: input.type,
    host,
    port: input.port,
    username,
    password,
    healthcheckUrl,
  }
}

function normalizeCredential(value: string | null): string | null {
  if (value === null || value.trim().length === 0) return null
  return value
}

function normalizeNullableText(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.trim()
  return normalized.length === 0 ? null : normalized
}

function auditConfiguration(configuration: NormalizedProxyConfiguration): Record<string, unknown> {
  return {
    name: configuration.name,
    type: configuration.type,
    host: configuration.host,
    port: configuration.port,
    hasUsername: configuration.username !== null,
    hasPassword: configuration.password !== null,
    hasHealthcheckUrl: configuration.healthcheckUrl !== null,
  }
}

type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]

async function writeProxyAudit(
  transaction: Transaction,
  context: ProxyAuditContext,
  event: {
    readonly action: string
    readonly targetId: string
    readonly changes: Record<string, unknown>
  },
): Promise<void> {
  await transaction.insert(auditEvents).values({
    id: createPublicId(),
    actorUserId: context.actorUserId,
    action: event.action,
    targetType: 'proxy',
    targetId: event.targetId,
    result: 'SUCCEEDED',
    requestId: context.requestId,
    changes: event.changes,
    metadata: {},
  })
}

function assertProxyId(proxyId: string): void {
  if (isPublicId(proxyId)) return
  throw badRequest('Proxy ID must be a UUIDv7.')
}

function badRequest(message: string): BrowShareError {
  return new BrowShareError({ code: 'BAD_REQUEST', message, statusCode: 400 })
}

function proxyNotFound(): BrowShareError {
  return new BrowShareError({
    code: 'NOT_FOUND',
    message: 'The Proxy does not exist.',
    statusCode: 404,
  })
}

function proxyNameConflict(cause: unknown): BrowShareError {
  return new BrowShareError({
    code: 'CONFLICT',
    message: 'A Proxy with this name already exists.',
    statusCode: 409,
    cause,
  })
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function toIsoTimestamp(value: string): string {
  return new Date(value).toISOString()
}

function toNullableIsoTimestamp(value: string | null): string | null {
  return value === null ? null : toIsoTimestamp(value)
}
