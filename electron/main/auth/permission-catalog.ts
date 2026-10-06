import { and, eq, isNull } from 'drizzle-orm'
import {
  isPermissionCode,
  OWNER_ROLE_NAME,
  PERMISSION_CODES,
  PERMISSION_META
} from '@shared/permissions'
import type { DbExecutor } from '../db/client'
import { markModified, permissions, rolePermissions, roles } from '../db/schema'

/**
 * Makes the `permissions` table match the code catalogue and gives every OWNER role every
 * permission. Runs at startup, so shipping a new permission in an update needs no manual step.
 */
export function syncPermissionCatalog(db: DbExecutor): void {
  const existing = new Map(
    db
      .select()
      .from(permissions)
      .all()
      .map((row) => [row.code, row])
  )

  for (const code of PERMISSION_CODES) {
    const meta = PERMISSION_META[code]
    const row = existing.get(code)
    if (!row) {
      db.insert(permissions)
        .values({
          code,
          label: meta.label,
          groupName: meta.group,
          description: meta.description
        })
        .run()
    } else if (
      row.label !== meta.label ||
      row.groupName !== meta.group ||
      row.description !== meta.description
    ) {
      db.update(permissions)
        .set({
          label: meta.label,
          groupName: meta.group,
          description: meta.description,
          ...markModified(permissions)
        })
        .where(eq(permissions.id, row.id))
        .run()
    }
  }

  const permissionRows = db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .all()
    .filter((row) => isPermissionCode(row.code))

  const ownerRoles = db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.isSystem, true), eq(roles.name, OWNER_ROLE_NAME), isNull(roles.deletedAt)))
    .all()

  for (const owner of ownerRoles) {
    const granted = new Set(
      db
        .select({ permissionId: rolePermissions.permissionId })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, owner.id))
        .all()
        .map((row) => row.permissionId)
    )
    for (const permission of permissionRows) {
      if (!granted.has(permission.id)) {
        db.insert(rolePermissions).values({ roleId: owner.id, permissionId: permission.id }).run()
      }
    }
  }
}
