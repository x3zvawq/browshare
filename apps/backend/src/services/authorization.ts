import { BrowShareError } from '@browshare/common'
import type { DatabaseConnection } from '@browshare/database'
import { permissions, rolePermissions, roles, userRoles, users } from '@browshare/database/schema'
import { and, eq, isNull } from 'drizzle-orm'

export interface AuthorizationPort {
  listUserPermissionCodes(userId: string): Promise<readonly string[]>
  hasPermission(userId: string, permissionCode: string): Promise<boolean>
  requirePermission(userId: string, permissionCode: string): Promise<void>
}

export class AuthorizationService implements AuthorizationPort {
  constructor(private readonly connection: Pick<DatabaseConnection, 'db'>) {}

  async listUserPermissionCodes(userId: string): Promise<readonly string[]> {
    const rows = await this.connection.db
      .selectDistinct({ code: permissions.code })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(users.id, userId),
          eq(users.status, 'ENABLED'),
          isNull(users.deletedAt),
          isNull(roles.deletedAt),
        ),
      )
      .orderBy(permissions.code)
    return rows.map(({ code }) => code)
  }

  async hasPermission(userId: string, permissionCode: string): Promise<boolean> {
    const [record] = await this.connection.db
      .select({ code: permissions.code })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(users.id, userId),
          eq(users.status, 'ENABLED'),
          isNull(users.deletedAt),
          isNull(roles.deletedAt),
          eq(permissions.code, permissionCode),
        ),
      )
      .limit(1)
    return record !== undefined
  }

  async requirePermission(userId: string, permissionCode: string): Promise<void> {
    if (await this.hasPermission(userId, permissionCode)) return
    throw new BrowShareError({
      code: 'FORBIDDEN',
      message: 'You do not have permission to perform this action.',
      statusCode: 403,
    })
  }
}
