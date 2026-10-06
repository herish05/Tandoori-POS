import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { RoleRef } from '@shared/domain'
import { isPermissionCode, type PermissionCode } from '@shared/permissions'
import type { DbExecutor } from '../db/client'
import { permissions, rolePermissions, roles, userRoles } from '../db/schema'

export interface UserAccess {
  roles: RoleRef[]
  permissions: Set<PermissionCode>
}

/** Permissions held by each role (deleted roles excluded). */
export function loadRolePermissions(
  db: DbExecutor,
  roleIds: readonly string[]
): Map<string, PermissionCode[]> {
  const result = new Map<string, PermissionCode[]>()
  if (roleIds.length === 0) return result
  for (const id of roleIds) result.set(id, [])

  const rows = db
    .select({ roleId: rolePermissions.roleId, code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(inArray(rolePermissions.roleId, [...roleIds]))
    .all()
  for (const row of rows) {
    if (isPermissionCode(row.code)) result.get(row.roleId)?.push(row.code)
  }
  return result
}

/** Everything a user may do, read fresh from the database so role changes apply immediately. */
export function loadAccess(db: DbExecutor, userId: string): UserAccess {
  const roleRows = db
    .select({ id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, userId), isNull(roles.deletedAt)))
    .all()

  const byRole = loadRolePermissions(
    db,
    roleRows.map((role) => role.id)
  )
  const granted = new Set<PermissionCode>()
  for (const codes of byRole.values()) for (const code of codes) granted.add(code)
  return { roles: roleRows, permissions: granted }
}
