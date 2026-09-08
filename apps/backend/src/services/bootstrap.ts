import { createPublicId } from '@browshare/common'
import type { DatabaseConnection } from '@browshare/database'
import {
  auditEvents,
  permissions,
  rolePermissions,
  roles,
  systemSettings,
  userRoles,
  users,
} from '@browshare/database/schema'
import { argon2id, hash as hashPassword } from 'argon2'
import { inArray, sql } from 'drizzle-orm'

import type { BootstrapAdminConfiguration } from '../configuration.js'

export const PERMISSION_DEFINITIONS = [
  { code: 'user.read', description: 'View users and non-sensitive user details.' },
  { code: 'user.manage', description: 'Create, edit, disable and delete users.' },
  { code: 'profile.read', description: 'View managed Profile details.' },
  { code: 'profile.manage', description: 'Manage Profiles, access, policies and scripts.' },
  { code: 'profile.maintain', description: 'Enter and end exclusive Profile maintenance.' },
  { code: 'worker.read', description: 'View Worker state, metrics and diagnostics.' },
  { code: 'worker.manage', description: 'Enroll, drain, disable and retire Workers.' },
  { code: 'proxy.read', description: 'View Proxy configuration.' },
  { code: 'proxy.manage', description: 'Create, edit, test and delete Proxies.' },
  {
    code: 'proxy.credential.read',
    description: 'Read complete Proxy usernames and passwords from the API.',
  },
  { code: 'system.manage', description: 'Manage system settings and initialization.' },
  { code: 'audit.read', description: 'View audit events.' },
  { code: 'session.use', description: 'Create and control authorized personal Sessions.' },
  { code: 'session.terminate_any', description: 'Terminate any ordinary Session.' },
] as const

export type PermissionCode = (typeof PERMISSION_DEFINITIONS)[number]['code']

export const PLATFORM_ADMIN_ROLE_CODE = 'platform_administrator'
export const MEMBER_ROLE_CODE = 'member'

export interface BootstrapState {
  readonly completed: boolean
  readonly userCount: number
}

export interface BootstrapResult extends BootstrapState {
  readonly outcome: 'initialized' | 'already-initialized' | 'uninitialized'
  readonly administratorUserId?: string
}

export async function inspectBootstrapState(
  connection: Pick<DatabaseConnection, 'client'>,
): Promise<BootstrapState> {
  const [state] = await connection.client<
    readonly { completed: boolean; userCount: string | number }[]
  >`
    select
      exists(select 1 from browshare_internal.bootstrap_state) as completed,
      (select count(*) from users) as "userCount"
  `
  if (state === undefined) throw new Error('Unable to inspect BrowShare bootstrap state')
  return { completed: state.completed, userCount: Number(state.userCount) }
}

export async function bootstrapDatabase(
  connection: DatabaseConnection,
  administrator: BootstrapAdminConfiguration | undefined,
  context: { readonly method: 'environment' | 'token'; readonly requestId?: string } = {
    method: 'environment',
  },
): Promise<BootstrapResult> {
  const current = await inspectBootstrapState(connection)
  if (current.completed) return { ...current, outcome: 'already-initialized' }
  assertEmptyUninitializedDatabase(current)
  if (administrator === undefined) return { ...current, outcome: 'uninitialized' }

  const passwordHash = await hashPassword(administrator.password, { type: argon2id })

  return connection.db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('browshare.bootstrap'))`)

    const [lockedState] = await transaction.execute<{
      completed: boolean
      userCount: string | number
    }>(sql`
      select
        exists(select 1 from browshare_internal.bootstrap_state) as completed,
        (select count(*) from users) as "userCount"
    `)
    if (lockedState === undefined) throw new Error('Unable to lock BrowShare bootstrap state')
    const state = {
      completed: lockedState.completed,
      userCount: Number(lockedState.userCount),
    }
    if (state.completed) return { ...state, outcome: 'already-initialized' as const }
    assertEmptyUninitializedDatabase(state)

    await transaction
      .insert(permissions)
      .values(
        PERMISSION_DEFINITIONS.map((permission) => ({
          id: createPublicId(),
          code: permission.code,
          description: permission.description,
        })),
      )
      .onConflictDoUpdate({
        target: permissions.code,
        set: { description: sql`excluded.description` },
      })

    await transaction
      .insert(roles)
      .values([
        {
          id: createPublicId(),
          code: PLATFORM_ADMIN_ROLE_CODE,
          name: 'Platform administrator',
          description: 'Built-in role containing all platform permissions.',
          isSystem: true,
        },
        {
          id: createPublicId(),
          code: MEMBER_ROLE_CODE,
          name: 'Member',
          description: 'Built-in role for users allowed to create authorized Sessions.',
          isSystem: true,
        },
      ])
      .onConflictDoUpdate({
        target: roles.code,
        set: {
          isSystem: true,
          deletedAt: null,
          updatedAt: sql`now()`,
        },
      })

    const permissionRows = await transaction
      .select({ id: permissions.id, code: permissions.code })
      .from(permissions)
      .where(
        inArray(
          permissions.code,
          PERMISSION_DEFINITIONS.map(({ code }) => code),
        ),
      )
    const roleRows = await transaction
      .select({ id: roles.id, code: roles.code })
      .from(roles)
      .where(inArray(roles.code, [PLATFORM_ADMIN_ROLE_CODE, MEMBER_ROLE_CODE]))

    const permissionIds = new Map(
      permissionRows.map((permission) => [permission.code, permission.id]),
    )
    const roleIds = new Map(roleRows.map((role) => [role.code, role.id]))
    const administratorRoleId = requiredMapValue(roleIds, PLATFORM_ADMIN_ROLE_CODE)
    const memberRoleId = requiredMapValue(roleIds, MEMBER_ROLE_CODE)

    await transaction
      .insert(rolePermissions)
      .values([
        ...PERMISSION_DEFINITIONS.map(({ code }) => ({
          roleId: administratorRoleId,
          permissionId: requiredMapValue(permissionIds, code),
        })),
        {
          roleId: memberRoleId,
          permissionId: requiredMapValue(permissionIds, 'session.use'),
        },
      ])
      .onConflictDoNothing()

    const administratorUserId = createPublicId()
    await transaction.insert(users).values({
      id: administratorUserId,
      email: administrator.email,
      displayName: administrator.displayName,
      passwordHash,
      maxActiveSessions: null,
      emailVerifiedAt: null,
    })
    await transaction.insert(userRoles).values({
      userId: administratorUserId,
      roleId: administratorRoleId,
      assignedByUserId: administratorUserId,
    })
    await transaction.insert(auditEvents).values({
      id: createPublicId(),
      actorUserId: administratorUserId,
      action: 'system.bootstrap',
      targetType: 'system',
      targetId: null,
      result: 'SUCCEEDED',
      ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      changes: {},
      metadata: { method: context.method },
    })
    await transaction
      .insert(systemSettings)
      .values([
        { key: 'registration.open', value: false },
        { key: 'auth.require_email_verification', value: false },
        { key: 'session.default_max_active', value: 1 },
      ])
      .onConflictDoNothing()

    await transaction.execute(sql`
      insert into browshare_internal.bootstrap_state (singleton)
      values (true)
    `)

    return {
      completed: true,
      userCount: 1,
      outcome: 'initialized' as const,
      administratorUserId,
    }
  })
}

function assertEmptyUninitializedDatabase(state: BootstrapState): void {
  if (!state.completed && state.userCount > 0) {
    throw new Error(
      'BrowShare bootstrap state is missing while users already exist; refusing automatic initialization',
    )
  }
}

function requiredMapValue<Key, Value>(values: ReadonlyMap<Key, Value>, key: Key): Value {
  const value = values.get(key)
  if (value === undefined) throw new Error(`Bootstrap record is missing for ${String(key)}`)
  return value
}
