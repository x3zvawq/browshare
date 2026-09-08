import { lockSessionPolicyConfiguration } from './session-policy-rules.js'
import { revokeTabSessions } from './session-revocation.js'
import {
  BrowShareError,
  createPublicId,
  decodePageCursor,
  encodePageCursor,
  normalizePageLimit,
} from '@browshare/common'
import type {
  CreateUserRequest,
  RoleResponse,
  UpdateUserRequest,
  UserListQuery,
  UserListResponse,
  UserResponse,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  authSessions,
  tabSessions,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@browshare/database/schema'
import { argon2id, hash } from 'argon2'
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'

import { MEMBER_ROLE_CODE } from './bootstrap.js'
import { isLastSystemManagerViolation, isPostgresUniqueViolation } from './database-errors.js'

export interface AuditContext {
  readonly actorUserId: string
  readonly requestId?: string
}

type UserRecord = typeof users.$inferSelect

export interface UserPort {
  list(query: UserListQuery): Promise<UserListResponse>
  get(userId: string): Promise<UserResponse>
  create(input: CreateUserRequest, context: AuditContext): Promise<UserResponse>
  update(userId: string, input: UpdateUserRequest, context: AuditContext): Promise<UserResponse>
  setState(
    userId: string,
    state: 'ENABLED' | 'DISABLED',
    context: AuditContext,
  ): Promise<UserResponse>
  delete(userId: string, context: AuditContext): Promise<void>
  setRoles(
    userId: string,
    requestedRoleIds: readonly string[],
    context: AuditContext,
  ): Promise<UserResponse>
  listRoles(): Promise<readonly RoleResponse[]>
}

export class UserService implements UserPort {
  constructor(private readonly connection: DatabaseConnection) {}

  async list(query: UserListQuery): Promise<UserListResponse> {
    const limit = normalizePageLimit(query.limit)
    const cursor = query.cursor === undefined ? undefined : decodePageCursor(query.cursor)
    const filters: SQL[] = []

    if (query.search !== undefined) {
      const searchText = query.search.trim()
      if (searchText.length === 0) {
        throw new BrowShareError({
          code: 'BAD_REQUEST',
          message: 'Search must not be blank.',
          statusCode: 400,
        })
      }
      const search = `%${escapeLike(searchText)}%`
      filters.push(or(ilike(users.email, search), ilike(users.displayName, search))!)
    }
    if (query.state === 'DELETED') filters.push(isNotNull(users.deletedAt))
    else if (query.state === 'ENABLED' || query.state === 'DISABLED') {
      filters.push(and(isNull(users.deletedAt), eq(users.status, query.state))!)
    } else if (query.state !== 'ALL') filters.push(isNull(users.deletedAt))

    if (cursor !== undefined) {
      filters.push(
        or(
          lt(users.createdAt, cursor.createdAt),
          and(eq(users.createdAt, cursor.createdAt), lt(users.id, cursor.id)),
        )!,
      )
    }

    const records = await this.connection.db
      .select()
      .from(users)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit + 1)
    const hasMore = records.length > limit
    const page = records.slice(0, limit)
    const items = await this.hydrate(page)
    const last = page.at(-1)

    return {
      items,
      meta: {
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? encodePageCursor({ id: last.id, createdAt: last.createdAt })
            : null,
      },
    }
  }

  async get(userId: string): Promise<UserResponse> {
    const [record] = await this.connection.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (record === undefined) throw userNotFound()
    return (await this.hydrate([record]))[0]!
  }

  async create(input: CreateUserRequest, context: AuditContext): Promise<UserResponse> {
    const email = normalizeEmail(input.email)
    const displayName = normalizeDisplayName(input.displayName)
    const passwordHash = await hashValidatedPassword(input.password)
    const userId = createPublicId()

    try {
      await this.connection.db.transaction(async (transaction) => {
        const roleIds =
          input.roleIds === undefined
            ? await findDefaultMemberRole(transaction)
            : await validateRoleIds(transaction, input.roleIds)

        await transaction.insert(users).values({
          id: userId,
          email,
          displayName,
          passwordHash,
          maxActiveSessions: input.maxActiveSessions === undefined ? 2 : input.maxActiveSessions,
          emailVerifiedAt: null,
        })
        if (roleIds.length > 0) {
          await transaction.insert(userRoles).values(
            roleIds.map((roleId) => ({
              userId,
              roleId,
              assignedByUserId: context.actorUserId,
            })),
          )
        }
        await writeAudit(transaction, context, {
          action: 'user.create',
          targetId: userId,
          changes: {
            email,
            displayName,
            maxActiveSessions: input.maxActiveSessions === undefined ? 2 : input.maxActiveSessions,
            roleIds,
          },
        })
      })
    } catch (cause) {
      if (isPostgresUniqueViolation(cause)) throw emailConflict(cause)
      throw cause
    }
    return this.get(userId)
  }

  async update(
    userId: string,
    input: UpdateUserRequest,
    context: AuditContext,
  ): Promise<UserResponse> {
    const changes = {
      ...(input.email === undefined ? {} : { email: normalizeEmail(input.email) }),
      ...(input.displayName === undefined
        ? {}
        : { displayName: normalizeDisplayName(input.displayName) }),
      ...(!('maxActiveSessions' in input)
        ? {}
        : { maxActiveSessions: input.maxActiveSessions ?? null }),
    }
    try {
      await this.connection.db.transaction(async (transaction) => {
        const updated = await transaction
          .update(users)
          .set({ ...changes, updatedAt: sql`now()` })
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .returning({ id: users.id })
        if (updated.length === 0) throw userNotFound()
        await writeAudit(transaction, context, {
          action: 'user.update',
          targetId: userId,
          changes,
        })
      })
    } catch (cause) {
      if (isPostgresUniqueViolation(cause)) throw emailConflict(cause)
      throw cause
    }
    return this.get(userId)
  }

  async setState(
    userId: string,
    state: 'ENABLED' | 'DISABLED',
    context: AuditContext,
  ): Promise<UserResponse> {
    try {
      await this.connection.db.transaction(async (transaction) => {
        await lockSessionPolicyConfiguration(transaction)
        const updated = await transaction
          .update(users)
          .set({ status: state, updatedAt: sql`now()` })
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .returning({ id: users.id })
        if (updated.length === 0) throw userNotFound()
        if (state === 'DISABLED') {
          await revokeUserSessions(transaction, userId, 'user_disabled')
          await revokeTabSessions(
            transaction,
            eq(tabSessions.userId, userId),
            'USER_DISABLED',
            context,
          )
        }
        await writeAudit(transaction, context, {
          action: state === 'ENABLED' ? 'user.enable' : 'user.disable',
          targetId: userId,
          changes: { state, revokedAllSessions: state === 'DISABLED' },
        })
      })
    } catch (cause) {
      throw mapLastManagerViolation(cause)
    }
    return this.get(userId)
  }

  async delete(userId: string, context: AuditContext): Promise<void> {
    try {
      await this.connection.db.transaction(async (transaction) => {
        await lockSessionPolicyConfiguration(transaction)
        const deleted = await transaction
          .update(users)
          .set({ deletedAt: sql`now()`, status: 'DISABLED', updatedAt: sql`now()` })
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .returning({ id: users.id })
        if (deleted.length === 0) throw userNotFound()
        await revokeUserSessions(transaction, userId, 'user_deleted')
        await revokeTabSessions(
          transaction,
          eq(tabSessions.userId, userId),
          'USER_DELETED',
          context,
        )
        await writeAudit(transaction, context, {
          action: 'user.delete',
          targetId: userId,
          changes: { softDeleted: true, revokedAllSessions: true },
        })
      })
    } catch (cause) {
      throw mapLastManagerViolation(cause)
    }
  }

  async setRoles(
    userId: string,
    requestedRoleIds: readonly string[],
    context: AuditContext,
  ): Promise<UserResponse> {
    try {
      await this.connection.db.transaction(async (transaction) => {
        await lockSessionPolicyConfiguration(transaction)
        const [user] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .limit(1)
        if (user === undefined) throw userNotFound()
        const roleIds = await validateRoleIds(transaction, requestedRoleIds)
        await transaction.delete(userRoles).where(eq(userRoles.userId, userId))
        if (roleIds.length > 0) {
          await transaction.insert(userRoles).values(
            roleIds.map((roleId) => ({
              userId,
              roleId,
              assignedByUserId: context.actorUserId,
            })),
          )
        }
        await revokeTabSessions(
          transaction,
          eq(tabSessions.userId, userId),
          'ACCESS_REVOKED',
          context,
        )
        await writeAudit(transaction, context, {
          action: 'user.roles.set',
          targetId: userId,
          changes: { roleIds },
        })
      })
    } catch (cause) {
      throw mapLastManagerViolation(cause)
    }
    return this.get(userId)
  }

  async listRoles(): Promise<readonly RoleResponse[]> {
    const roleRows = await this.connection.db
      .select({
        id: roles.id,
        code: roles.code,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
      })
      .from(roles)
      .where(isNull(roles.deletedAt))
      .orderBy(roles.name, roles.id)
    const permissionRows = await this.connection.db
      .select({ roleId: rolePermissions.roleId, code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        inArray(
          rolePermissions.roleId,
          roleRows.map(({ id }) => id),
        ),
      )
      .orderBy(permissions.code)
    const permissionsByRole = groupValues(permissionRows, 'roleId', 'code')
    return roleRows.map((role) => ({
      ...role,
      permissions: permissionsByRole.get(role.id) ?? [],
    }))
  }

  private async hydrate(records: readonly UserRecord[]): Promise<UserResponse[]> {
    if (records.length === 0) return []
    const roleRows = await this.connection.db
      .select({ userId: userRoles.userId, roleId: roles.id, roleCode: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        inArray(
          userRoles.userId,
          records.map(({ id }) => id),
        ),
      )
      .orderBy(roles.code)
    const roleIdsByUser = groupValues(roleRows, 'userId', 'roleId')
    const roleCodesByUser = groupValues(roleRows, 'userId', 'roleCode')
    return records.map((record) => ({
      id: record.id,
      email: record.email,
      displayName: record.displayName,
      state: record.deletedAt === null ? record.status : 'DELETED',
      maxActiveSessions: record.maxActiveSessions,
      emailVerifiedAt: record.emailVerifiedAt,
      roleIds: roleIdsByUser.get(record.id) ?? [],
      roleCodes: roleCodesByUser.get(record.id) ?? [],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }))
  }
}

type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0]

async function validateRoleIds(
  transaction: Transaction,
  requestedRoleIds: readonly string[],
): Promise<readonly string[]> {
  const roleIds = [...new Set(requestedRoleIds)]
  if (roleIds.length === 0) return []
  const found = await transaction
    .select({ id: roles.id })
    .from(roles)
    .where(and(inArray(roles.id, roleIds), isNull(roles.deletedAt)))
  if (found.length !== roleIds.length) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: 'One or more selected roles do not exist.',
      statusCode: 400,
    })
  }
  return roleIds
}

async function findDefaultMemberRole(transaction: Transaction): Promise<readonly string[]> {
  const [role] = await transaction
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.code, MEMBER_ROLE_CODE), isNull(roles.deletedAt)))
    .limit(1)
  if (role === undefined) throw new Error('The built-in member role is unavailable')
  return [role.id]
}

async function revokeUserSessions(
  transaction: Transaction,
  userId: string,
  reason: string,
): Promise<void> {
  await transaction
    .update(authSessions)
    .set({ revokedAt: sql`now()`, revokeReason: reason, updatedAt: sql`now()` })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
}

async function writeAudit(
  transaction: Transaction,
  context: AuditContext,
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
    targetType: 'user',
    targetId: event.targetId,
    result: 'SUCCEEDED',
    requestId: context.requestId,
    changes: event.changes,
    metadata: {},
  })
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase()
  const separator = email.indexOf('@')
  if (
    separator < 1 ||
    separator !== email.lastIndexOf('@') ||
    separator === email.length - 1 ||
    email.length > 320
  ) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: 'Email must be a valid address.',
      statusCode: 400,
    })
  }
  return email
}

function normalizeDisplayName(value: string): string {
  const displayName = value.trim()
  if (displayName.length === 0 || displayName.length > 128) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: 'Display name must contain between 1 and 128 characters.',
      statusCode: 400,
    })
  }
  return displayName
}

async function hashValidatedPassword(password: string): Promise<string> {
  if (password.length < 10 || password.length > 1024) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: 'Password must contain between 10 and 1024 characters.',
      statusCode: 400,
    })
  }
  return hash(password, { type: argon2id })
}

function mapLastManagerViolation(cause: unknown): unknown {
  if (!isLastSystemManagerViolation(cause)) return cause
  return new BrowShareError({
    code: 'LAST_SYSTEM_MANAGER',
    message: 'The last enabled system manager cannot be disabled, deleted or unassigned.',
    statusCode: 409,
    cause,
  })
}

function emailConflict(cause: unknown): BrowShareError {
  return new BrowShareError({
    code: 'CONFLICT',
    message: 'An account with this email already exists.',
    statusCode: 409,
    cause,
  })
}

function userNotFound(): BrowShareError {
  return new BrowShareError({
    code: 'NOT_FOUND',
    message: 'The user does not exist.',
    statusCode: 404,
  })
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`)
}

function groupValues<
  Row extends Record<Key | Value, string>,
  Key extends keyof Row,
  Value extends keyof Row,
>(rows: readonly Row[], key: Key, value: Value): Map<string, string[]> {
  const grouped = new Map<string, string[]>()
  for (const row of rows) {
    const values = grouped.get(row[key]) ?? []
    values.push(row[value])
    grouped.set(row[key], values)
  }
  return grouped
}
