import { createHmac, createHash, randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

import { BrowShareError, createPublicId } from '@browshare/common'
import type {
  AuthSessionResponse,
  PortalSessionDevice,
  PublicAuthConfiguration,
} from '@browshare/contracts'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  authSessions,
  tabSessions,
  roles,
  userRoles,
  users,
} from '@browshare/database/schema'
import { argon2id, hash, needsRehash, verify } from 'argon2'
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm'

import { readRegistrationSettings } from './system-settings.js'

import { lockSessionPolicyConfiguration } from './session-policy-rules.js'
import { revokeTabSessions } from './session-revocation.js'
import type { AuthorizationService } from './authorization.js'
import { inspectBootstrapState, MEMBER_ROLE_CODE } from './bootstrap.js'
import { isPostgresUniqueViolation } from './database-errors.js'

const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000
const SESSION_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000
const LOGIN_FAILURE_RETENTION_MS = 15 * 60 * 1000
const MAX_LOGIN_DELAY_MS = 2_000

export const PORTAL_SESSION_COOKIE = 'browshare_session'

export interface LoginContext {
  readonly ip: string
  readonly userAgent?: string
  readonly requestId?: string
}

export interface IssuedAuthentication {
  readonly token: string
  readonly response: AuthSessionResponse
}

export interface AuthenticatedPortalSession extends AuthSessionResponse {
  readonly sessionId: string
}

export interface AuthenticationPort {
  getPublicConfiguration(): Promise<PublicAuthConfiguration>
  login(email: string, password: string, context: LoginContext): Promise<IssuedAuthentication>
  register(email: string, password: string, context: LoginContext): Promise<IssuedAuthentication>
  authenticate(token: string): Promise<AuthenticatedPortalSession | undefined>
  logout(token: string): Promise<void>
  changePassword(options: {
    userId: string
    currentSessionId: string
    currentPassword: string
    newPassword: string
    requestId?: string
  }): Promise<void>
  resetUserPassword(options: {
    actorUserId: string
    userId: string
    newPassword: string
    requestId?: string
  }): Promise<void>
  listSessions(userId: string, currentSessionId: string): Promise<readonly PortalSessionDevice[]>
  revokeSession(options: {
    actorUserId: string
    userId: string
    sessionId: string
    requestId?: string
  }): Promise<void>
  revokeAllSessions(options: {
    actorUserId: string
    userId: string
    requestId?: string
  }): Promise<void>
}

export class AuthenticationService implements AuthenticationPort {
  private constructor(
    private readonly connection: DatabaseConnection,
    private readonly authorization: AuthorizationService,
    private readonly privacySecret: string,
    private readonly dummyPasswordHash: string,
    private readonly throttle: LoginThrottle,
  ) {}

  static async create(options: {
    readonly connection: DatabaseConnection
    readonly authorization: AuthorizationService
    readonly privacySecret: string
  }): Promise<AuthenticationService> {
    return new AuthenticationService(
      options.connection,
      options.authorization,
      options.privacySecret,
      await hash(randomBytes(32), { type: argon2id }),
      new LoginThrottle(),
    )
  }

  async getPublicConfiguration(): Promise<PublicAuthConfiguration> {
    const bootstrap = await inspectBootstrapState(this.connection)
    if (!bootstrap.completed && bootstrap.userCount === 0) {
      return { registrationOpen: false, emailVerificationRequired: false }
    }
    const settings = await readRegistrationSettings(this.connection.db)
    return {
      registrationOpen: settings.registrationOpen,
      emailVerificationRequired: settings.emailVerificationRequired,
    }
  }

  async login(
    emailInput: string,
    password: string,
    context: LoginContext,
  ): Promise<IssuedAuthentication> {
    const email = normalizeLoginEmail(emailInput)
    const identifierHash = this.privateDigest(email)
    const ipHash = this.privateDigest(context.ip)
    await this.throttle.beforeAttempt(identifierHash, ipHash)

    const [user] = await this.connection.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        status: users.status,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    const passwordMatches = await safeVerify(user?.passwordHash ?? this.dummyPasswordHash, password)
    if (
      user === undefined ||
      !passwordMatches ||
      user.status !== 'ENABLED' ||
      user.deletedAt !== null
    ) {
      this.throttle.recordFailure(identifierHash, ipHash)
      await this.writeLoginAudit({
        result: 'DENIED',
        actorUserId: user?.id ?? null,
        ipHash,
        identifierHash,
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      })
      throw authenticationFailed()
    }

    this.throttle.recordSuccess(identifierHash)
    if (needsRehash(user.passwordHash)) {
      await this.connection.db
        .update(users)
        .set({ passwordHash: await hash(password, { type: argon2id }), updatedAt: sql`now()` })
        .where(eq(users.id, user.id))
    }

    const authentication = await this.issueSession(user, context, ipHash)
    await this.writeLoginAudit({
      result: 'SUCCEEDED',
      actorUserId: user.id,
      ipHash,
      identifierHash,
      ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
    })
    return authentication
  }

  async register(
    emailInput: string,
    password: string,
    context: LoginContext,
  ): Promise<IssuedAuthentication> {
    const registration = await readRegistrationSettings(this.connection.db)
    if (!registration.registrationOpen || registration.emailVerificationRequired) {
      throw new BrowShareError({
        code: 'REGISTRATION_DISABLED',
        message: 'Self-service registration is not available.',
        statusCode: 403,
      })
    }
    const email = normalizeRegistrationEmail(emailInput)
    assertPassword(password)
    const passwordHash = await hash(password, { type: argon2id })
    const userId = createPublicId()
    const displayName = email.slice(0, email.indexOf('@')).slice(0, 128)
    const ipHash = this.privateDigest(context.ip)

    try {
      await this.connection.db.transaction(async (transaction) => {
        // Serialize admission with registration-setting writes after expensive password hashing.
        const currentRegistration = await readRegistrationSettings(transaction, 'share')
        if (
          !currentRegistration.registrationOpen ||
          currentRegistration.emailVerificationRequired
        ) {
          throw new BrowShareError({
            code: 'REGISTRATION_DISABLED',
            statusCode: 403,
            message: 'Self-service registration is not available.',
          })
        }
        const [memberRole] = await transaction
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.code, MEMBER_ROLE_CODE), isNull(roles.deletedAt)))
          .limit(1)
        if (memberRole === undefined) {
          throw new Error('The built-in member role is unavailable')
        }

        await transaction.insert(users).values({
          id: userId,
          email,
          displayName,
          passwordHash,
          maxActiveSessions: currentRegistration.defaultMaxActiveSessions,
          emailVerifiedAt: null,
        })
        await transaction.insert(userRoles).values({
          userId,
          roleId: memberRole.id,
          assignedByUserId: null,
        })
        await transaction.insert(auditEvents).values({
          id: createPublicId(),
          actorUserId: userId,
          action: 'auth.register',
          targetType: 'user',
          targetId: userId,
          result: 'SUCCEEDED',
          sourceIpHash: ipHash,
          requestId: context.requestId,
          changes: {},
          metadata: {},
        })
      })
    } catch (cause) {
      if (isPostgresUniqueViolation(cause)) {
        throw new BrowShareError({
          code: 'CONFLICT',
          message: 'An account with this email already exists.',
          statusCode: 409,
          cause,
        })
      }
      throw cause
    }

    return this.issueSession({ id: userId, email, displayName }, context, ipHash)
  }

  async authenticate(token: string): Promise<AuthenticatedPortalSession | undefined> {
    const now = Date.now()
    const [record] = await this.connection.db
      .select({
        sessionId: authSessions.id,
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        expiresAt: authSessions.expiresAt,
        lastSeenAt: authSessions.lastSeenAt,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(
          eq(authSessions.tokenDigest, digestToken(token)),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date(now).toISOString()),
          eq(users.status, 'ENABLED'),
          isNull(users.deletedAt),
        ),
      )
      .limit(1)
    if (record === undefined) return undefined

    const expiresAt = new Date(record.expiresAt).getTime()
    const lastSeenAt = new Date(record.lastSeenAt).getTime()
    const refreshExpiry = expiresAt - now <= SESSION_REFRESH_THRESHOLD_MS
    const writeLastSeen = now - lastSeenAt >= LAST_SEEN_WRITE_INTERVAL_MS
    const nextExpiresAt = refreshExpiry
      ? new Date(now + SESSION_LIFETIME_MS).toISOString()
      : record.expiresAt

    if (refreshExpiry || writeLastSeen) {
      await this.connection.db
        .update(authSessions)
        .set({
          expiresAt: nextExpiresAt,
          lastSeenAt: new Date(now).toISOString(),
          updatedAt: sql`now()`,
        })
        .where(and(eq(authSessions.id, record.sessionId), isNull(authSessions.revokedAt)))
    }

    return {
      sessionId: record.sessionId,
      user: {
        id: record.userId,
        email: record.email,
        displayName: record.displayName,
        permissions: [...(await this.authorization.listUserPermissionCodes(record.userId))],
      },
      expiresAt: nextExpiresAt,
    }
  }

  async logout(token: string): Promise<void> {
    await this.connection.db
      .update(authSessions)
      .set({ revokedAt: sql`now()`, revokeReason: 'user_logout', updatedAt: sql`now()` })
      .where(and(eq(authSessions.tokenDigest, digestToken(token)), isNull(authSessions.revokedAt)))
  }

  async changePassword(options: {
    userId: string
    currentSessionId: string
    currentPassword: string
    newPassword: string
    requestId?: string
  }): Promise<void> {
    assertPassword(options.newPassword)
    const [user] = await this.connection.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.id, options.userId), isNull(users.deletedAt)))
      .limit(1)
    if (user === undefined || !(await safeVerify(user.passwordHash, options.currentPassword))) {
      throw new BrowShareError({
        code: 'PASSWORD_MISMATCH',
        message: 'The current password is incorrect.',
        statusCode: 400,
      })
    }

    const passwordHash = await hash(options.newPassword, { type: argon2id })
    await this.connection.db.transaction(async (transaction) => {
      await transaction
        .update(users)
        .set({ passwordHash, updatedAt: sql`now()` })
        .where(eq(users.id, options.userId))
      await transaction
        .update(authSessions)
        .set({
          revokedAt: sql`now()`,
          revokeReason: 'password_changed',
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(authSessions.userId, options.userId),
            ne(authSessions.id, options.currentSessionId),
            isNull(authSessions.revokedAt),
          ),
        )
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: options.userId,
        action: 'auth.password.change',
        targetType: 'user',
        targetId: options.userId,
        result: 'SUCCEEDED',
        requestId: options.requestId,
        changes: { revokedOtherSessions: true },
        metadata: {},
      })
    })
  }

  async resetUserPassword(options: {
    actorUserId: string
    userId: string
    newPassword: string
    requestId?: string
  }): Promise<void> {
    assertPassword(options.newPassword)
    const passwordHash = await hash(options.newPassword, { type: argon2id })
    await this.connection.db.transaction(async (transaction) => {
      await lockSessionPolicyConfiguration(transaction)
      const updated = await transaction
        .update(users)
        .set({ passwordHash, updatedAt: sql`now()` })
        .where(and(eq(users.id, options.userId), isNull(users.deletedAt)))
        .returning({ id: users.id })
      if (updated.length === 0) throw userNotFound()
      await transaction
        .update(authSessions)
        .set({
          revokedAt: sql`now()`,
          revokeReason: 'administrator_password_reset',
          updatedAt: sql`now()`,
        })
        .where(and(eq(authSessions.userId, options.userId), isNull(authSessions.revokedAt)))
      await revokeTabSessions(
        transaction,
        eq(tabSessions.userId, options.userId),
        'PASSWORD_RESET',
        {
          actorUserId: options.actorUserId,
          ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
        },
        false,
      )
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: options.actorUserId,
        action: 'user.password.reset',
        targetType: 'user',
        targetId: options.userId,
        result: 'SUCCEEDED',
        requestId: options.requestId,
        changes: { revokedAllSessions: true },
        metadata: {},
      })
    })
  }

  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<readonly PortalSessionDevice[]> {
    const records = await this.connection.db
      .select({
        id: authSessions.id,
        deviceName: authSessions.deviceName,
        userAgentSummary: authSessions.userAgentSummary,
        lastSeenAt: authSessions.lastSeenAt,
        expiresAt: authSessions.expiresAt,
      })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date().toISOString()),
        ),
      )
      .orderBy(sql`${authSessions.lastSeenAt} desc`)
    return records.map((record) => ({ ...record, current: record.id === currentSessionId }))
  }

  async revokeSession(options: {
    actorUserId: string
    userId: string
    sessionId: string
    requestId?: string
  }): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      const revoked = await transaction
        .update(authSessions)
        .set({ revokedAt: sql`now()`, revokeReason: 'user_revoked', updatedAt: sql`now()` })
        .where(
          and(
            eq(authSessions.id, options.sessionId),
            eq(authSessions.userId, options.userId),
            isNull(authSessions.revokedAt),
          ),
        )
        .returning({ id: authSessions.id })
      if (revoked.length === 0) {
        throw new BrowShareError({
          code: 'NOT_FOUND',
          message: 'The Portal Session does not exist.',
          statusCode: 404,
        })
      }
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: options.actorUserId,
        action: 'auth.session.revoke',
        targetType: 'auth_session',
        targetId: options.sessionId,
        result: 'SUCCEEDED',
        requestId: options.requestId,
        changes: {},
        metadata: {},
      })
    })
  }

  async revokeAllSessions(options: {
    actorUserId: string
    userId: string
    requestId?: string
  }): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      await transaction
        .update(authSessions)
        .set({ revokedAt: sql`now()`, revokeReason: 'user_revoked_all', updatedAt: sql`now()` })
        .where(and(eq(authSessions.userId, options.userId), isNull(authSessions.revokedAt)))
      await transaction.insert(auditEvents).values({
        id: createPublicId(),
        actorUserId: options.actorUserId,
        action: 'auth.session.revoke_all',
        targetType: 'user',
        targetId: options.userId,
        result: 'SUCCEEDED',
        requestId: options.requestId,
        changes: {},
        metadata: {},
      })
    })
  }

  private async issueSession(
    user: { readonly id: string; readonly email: string; readonly displayName: string },
    context: LoginContext,
    ipHash: string,
  ): Promise<IssuedAuthentication> {
    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString()
    await this.connection.db.insert(authSessions).values({
      id: createPublicId(),
      userId: user.id,
      tokenDigest: digestToken(token),
      userAgentSummary: context.userAgent?.slice(0, 512),
      ipHash,
      expiresAt,
      lastSeenAt: now.toISOString(),
    })
    return {
      token,
      response: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          permissions: [...(await this.authorization.listUserPermissionCodes(user.id))],
        },
        expiresAt,
      },
    }
  }

  private privateDigest(value: string): string {
    return createHmac('sha256', this.privacySecret).update(value).digest('hex')
  }

  private async writeLoginAudit(options: {
    readonly result: 'SUCCEEDED' | 'DENIED'
    readonly actorUserId: string | null
    readonly ipHash: string
    readonly identifierHash: string
    readonly requestId?: string
  }): Promise<void> {
    await this.connection.db.insert(auditEvents).values({
      id: createPublicId(),
      actorUserId: options.actorUserId,
      action: 'auth.login',
      targetType: 'user',
      targetId: options.actorUserId,
      result: options.result,
      sourceIpHash: options.ipHash,
      requestId: options.requestId,
      changes: {},
      metadata: { identifierHash: options.identifierHash },
    })
  }
}

class LoginThrottle {
  private readonly failures = new Map<string, { count: number; expiresAt: number }>()

  async beforeAttempt(identifierHash: string, ipHash: string): Promise<void> {
    const failureCount = Math.max(this.failureCount(identifierHash), this.failureCount(ipHash))
    if (failureCount === 0) return
    const waitMilliseconds = Math.min(200 * 2 ** (failureCount - 1), MAX_LOGIN_DELAY_MS)
    await delay(waitMilliseconds)
  }

  recordFailure(identifierHash: string, ipHash: string): void {
    this.increment(identifierHash)
    this.increment(ipHash)
  }

  recordSuccess(identifierHash: string): void {
    this.failures.delete(identifierHash)
  }

  private failureCount(key: string): number {
    const record = this.failures.get(key)
    if (record === undefined) return 0
    if (record.expiresAt <= Date.now()) {
      this.failures.delete(key)
      return 0
    }
    return record.count
  }

  private increment(key: string): void {
    this.failures.set(key, {
      count: this.failureCount(key) + 1,
      expiresAt: Date.now() + LOGIN_FAILURE_RETENTION_MS,
    })
  }
}

function normalizeLoginEmail(value: string): string {
  const email = normalizedEmailOrUndefined(value)
  if (email !== undefined) return email
  throw authenticationFailed()
}

function normalizeRegistrationEmail(value: string): string {
  const email = normalizedEmailOrUndefined(value)
  if (email !== undefined) return email
  throw new BrowShareError({
    code: 'BAD_REQUEST',
    message: 'Email must be a valid address.',
    statusCode: 400,
  })
}

function normalizedEmailOrUndefined(value: string): string | undefined {
  const email = value.trim().toLowerCase()
  const separator = email.indexOf('@')
  if (
    separator < 1 ||
    separator !== email.lastIndexOf('@') ||
    separator === email.length - 1 ||
    email.length > 320
  ) {
    return undefined
  }
  return email
}

function assertPassword(password: string): void {
  if (password.length < 10 || password.length > 1024) {
    throw new BrowShareError({
      code: 'BAD_REQUEST',
      message: 'Password must contain between 10 and 1024 characters.',
      statusCode: 400,
    })
  }
}

async function safeVerify(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function authenticationFailed(): BrowShareError {
  return new BrowShareError({
    code: 'AUTHENTICATION_FAILED',
    message: 'Invalid email or password.',
    statusCode: 401,
  })
}

function userNotFound(): BrowShareError {
  return new BrowShareError({
    code: 'NOT_FOUND',
    message: 'The user does not exist.',
    statusCode: 404,
  })
}
