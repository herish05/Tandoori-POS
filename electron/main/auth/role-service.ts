import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { CreateRoleData, UpdateRoleData } from '@shared/auth-schemas'
import type { PermissionInfo, RoleSummary } from '@shared/domain'
import {
  PERMISSION_CODES,
  PERMISSION_META,
  withImpliedPermissions,
  type PermissionCode
} from '@shared/permissions'
import { loadRolePermissions } from '../auth/access'
import type { AuditService } from '../auth/audit-service'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { markModified, permissions, rolePermissions, roles, userRoles, users } from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'

type RoleRow = typeof roles.$inferSelect

export function listPermissionInfo(): PermissionInfo[] {
  return PERMISSION_CODES.map((code) => ({ code, ...PERMISSION_META[code] }))
}

/** Rule used everywhere: nobody can hand out, or touch, more access than they hold themselves. */
export function assertHoldsAll(auth: AuthContext, codes: readonly PermissionCode[]): void {
  if (codes.some((code) => !auth.permissions.has(code))) {
    throw new AppError(
      'FORBIDDEN',
      'You cannot grant or change access that is greater than your own.'
    )
  }
}

export class RoleService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService
  ) {}

  list(): RoleSummary[] {
    const rows = this.db
      .select()
      .from(roles)
      .where(isNull(roles.deletedAt))
      .orderBy(roles.name)
      .all()
    const byRole = loadRolePermissions(
      this.db,
      rows.map((row) => row.id)
    )
    const counts = new Map(
      this.db
        .select({ roleId: userRoles.roleId, count: sql<number>`count(*)` })
        .from(userRoles)
        .innerJoin(users, eq(userRoles.userId, users.id))
        .where(isNull(users.deletedAt))
        .groupBy(userRoles.roleId)
        .all()
        .map((row) => [row.roleId, row.count])
    )
    return rows.map((row) => this.toSummary(row, byRole.get(row.id) ?? [], counts.get(row.id) ?? 0))
  }

  create(auth: AuthContext, input: CreateRoleData): RoleSummary {
    const codes = withImpliedPermissions(input.permissions)
    assertHoldsAll(auth, codes)

    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      this.assertNameFree(tx, input.name, null)
      const role = tx
        .insert(roles)
        .values({ restaurantId, name: input.name, description: input.description })
        .returning()
        .get()
      this.writePermissions(tx, role.id, codes)
      this.audit.record(
        {
          action: 'role.created',
          userId: auth.userId,
          username: auth.username,
          entityType: 'role',
          entityId: role.id,
          details: { name: role.name, permissions: codes }
        },
        tx
      )
      return role.id
    })
    return this.getSummary(id)
  }

  update(auth: AuthContext, input: UpdateRoleData): RoleSummary {
    const codes = withImpliedPermissions(input.permissions)
    this.db.transaction((tx) => {
      const role = this.requireEditable(tx, input.id)
      assertHoldsAll(auth, loadRolePermissions(tx, [role.id]).get(role.id) ?? [])
      assertHoldsAll(auth, codes)
      this.assertNameFree(tx, input.name, role.id)

      tx.update(roles)
        .set({ name: input.name, description: input.description, ...markModified(roles) })
        .where(eq(roles.id, role.id))
        .run()
      this.writePermissions(tx, role.id, codes)
      this.audit.record(
        {
          action: 'role.updated',
          userId: auth.userId,
          username: auth.username,
          entityType: 'role',
          entityId: role.id,
          details: { name: input.name, permissions: codes }
        },
        tx
      )
    })
    return this.getSummary(input.id)
  }

  delete(auth: AuthContext, id: string): void {
    this.db.transaction((tx) => {
      const role = this.requireEditable(tx, id)
      assertHoldsAll(auth, loadRolePermissions(tx, [role.id]).get(role.id) ?? [])

      const assigned =
        tx
          .select({ count: sql<number>`count(*)` })
          .from(userRoles)
          .innerJoin(users, eq(userRoles.userId, users.id))
          .where(and(eq(userRoles.roleId, role.id), isNull(users.deletedAt)))
          .get()?.count ?? 0
      if (assigned > 0) {
        throw new AppError(
          'CONFLICT',
          `This role is assigned to ${String(assigned)} staff member${assigned === 1 ? '' : 's'}. Move them to another role first.`
        )
      }

      tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id)).run()
      tx.update(roles)
        .set({ deletedAt: new Date(), ...markModified(roles) })
        .where(eq(roles.id, role.id))
        .run()
      this.audit.record(
        {
          action: 'role.deleted',
          userId: auth.userId,
          username: auth.username,
          entityType: 'role',
          entityId: role.id,
          details: { name: role.name }
        },
        tx
      )
    })
  }

  private getSummary(id: string): RoleSummary {
    const summary = this.list().find((role) => role.id === id)
    if (!summary) throw new AppError('NOT_FOUND', 'That role no longer exists.')
    return summary
  }

  private requireEditable(db: DbExecutor, id: string): RoleRow {
    const role = db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), isNull(roles.deletedAt)))
      .get()
    if (!role) throw new AppError('NOT_FOUND', 'That role no longer exists.')
    if (role.isSystem) {
      throw new AppError('CONFLICT', `The ${role.name} role is built in and cannot be changed.`)
    }
    return role
  }

  private assertNameFree(db: DbExecutor, name: string, exceptId: string | null): void {
    const clash = db
      .select({ id: roles.id })
      .from(roles)
      .where(and(isNull(roles.deletedAt), sql`lower(${roles.name}) = lower(${name})`))
      .all()
      .some((row) => row.id !== exceptId)
    if (clash) throw new AppError('CONFLICT', 'A role with that name already exists.')
  }

  private writePermissions(db: DbExecutor, roleId: string, codes: readonly PermissionCode[]): void {
    db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId)).run()
    if (codes.length === 0) return
    const rows = db
      .select({ id: permissions.id })
      .from(permissions)
      .where(inArray(permissions.code, [...codes]))
      .all()
    for (const row of rows) {
      db.insert(rolePermissions).values({ roleId, permissionId: row.id }).run()
    }
  }

  private toSummary(row: RoleRow, codes: PermissionCode[], userCount: number): RoleSummary {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      permissions: PERMISSION_CODES.filter((code) => codes.includes(code)),
      userCount
    }
  }
}
