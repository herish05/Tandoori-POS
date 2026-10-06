import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { CreateStaffData, ResetPasswordData, UpdateStaffData } from '@shared/auth-schemas'
import type { RoleRef, StaffMember } from '@shared/domain'
import { OWNER_ROLE_NAME } from '@shared/permissions'
import { loadAccess, loadRolePermissions } from '../auth/access'
import type { AuditService } from '../auth/audit-service'
import type { AuthService } from '../auth/auth-service'
import { hashPassword } from '../auth/password'
import type { AuthContext } from '../auth/types'
import type { AppDatabase, DbExecutor } from '../db/client'
import { markModified, roles, userRoles, users } from '../db/schema'
import { AppError } from '../ipc/errors'
import { requireRestaurantId } from '../restaurant/restaurant-service'
import { assertHoldsAll } from '../auth/role-service'

type UserRow = typeof users.$inferSelect

export class UserService {
  constructor(
    private readonly db: AppDatabase,
    private readonly audit: AuditService,
    private readonly auth: AuthService
  ) {}

  list(): StaffMember[] {
    const rows = this.db
      .select()
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(users.fullName)
      .all()
    const rolesByUser = this.rolesByUser(rows.map((row) => row.id))
    return rows.map((row) => this.toMember(row, rolesByUser.get(row.id) ?? []))
  }

  /** Roles the signed-in user is allowed to hand out (those that do not exceed their own access). */
  assignableRoles(auth: AuthContext): RoleRef[] {
    const rows = this.db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(isNull(roles.deletedAt))
      .orderBy(roles.name)
      .all()
    const perms = loadRolePermissions(
      this.db,
      rows.map((row) => row.id)
    )
    return rows.filter((row) =>
      (perms.get(row.id) ?? []).every((code) => auth.permissions.has(code))
    )
  }

  async create(auth: AuthContext, input: CreateStaffData): Promise<StaffMember> {
    this.assertAssignable(this.db, auth, input.roleIds)
    const passwordHash = await hashPassword(input.password)

    const id = this.db.transaction((tx) => {
      const restaurantId = requireRestaurantId(tx)
      const taken = tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, input.username), isNull(users.deletedAt)))
        .get()
      if (taken) throw new AppError('CONFLICT', 'That username is already taken.')

      const userId = randomUUID()
      tx.insert(users)
        .values({
          id: userId,
          restaurantId,
          username: input.username,
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          passwordHash,
          isActive: true,
          // The person receiving the account chooses their own password at first sign-in.
          mustChangePassword: true
        })
        .run()
      for (const roleId of new Set(input.roleIds)) {
        tx.insert(userRoles).values({ userId, roleId }).run()
      }
      this.audit.record(
        {
          action: 'user.created',
          userId: auth.userId,
          username: auth.username,
          entityType: 'user',
          entityId: userId,
          details: { newUsername: input.username, roleIds: input.roleIds }
        },
        tx
      )
      return userId
    })
    return this.getMember(id)
  }

  update(auth: AuthContext, input: UpdateStaffData): StaffMember {
    const roleIds = [...new Set(input.roleIds)]
    const revokeSessions = this.db.transaction((tx) => {
      const target = this.requireUser(tx, input.id)
      this.assertCanManage(tx, auth, target.id)
      this.assertAssignable(tx, auth, roleIds)

      const currentRoleIds = loadAccess(tx, target.id).roles.map((role) => role.id)
      const rolesChanged =
        currentRoleIds.length !== roleIds.length ||
        roleIds.some((id) => !currentRoleIds.includes(id))

      if (target.id === auth.userId) {
        if (!input.isActive) {
          throw new AppError('CONFLICT', 'You cannot deactivate your own account.')
        }
        if (rolesChanged) {
          throw new AppError('CONFLICT', 'You cannot change your own roles.')
        }
      }
      this.assertOwnerRemains(tx, target, input.isActive, roleIds)

      tx.update(users)
        .set({
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          isActive: input.isActive,
          ...markModified(users)
        })
        .where(eq(users.id, target.id))
        .run()

      if (rolesChanged) {
        tx.delete(userRoles).where(eq(userRoles.userId, target.id)).run()
        for (const roleId of roleIds)
          tx.insert(userRoles).values({ userId: target.id, roleId }).run()
      }

      const base = {
        userId: auth.userId,
        username: auth.username,
        entityType: 'user',
        entityId: target.id
      }
      this.audit.record(
        {
          ...base,
          action: 'user.updated',
          details: { targetUsername: target.username, rolesChanged }
        },
        tx
      )
      if (target.isActive !== input.isActive) {
        this.audit.record(
          {
            ...base,
            action: input.isActive ? 'user.activated' : 'user.deactivated',
            details: { targetUsername: target.username }
          },
          tx
        )
      }
      return !input.isActive || rolesChanged
    })

    if (revokeSessions) this.auth.revokeUserSessions(input.id, 'ACCESS_CHANGED')
    return this.getMember(input.id)
  }

  async resetPassword(auth: AuthContext, input: ResetPasswordData): Promise<void> {
    if (input.id === auth.userId) {
      throw new AppError('CONFLICT', 'Use “Change password” to change your own password.')
    }
    const passwordHash = await hashPassword(input.newPassword)

    this.db.transaction((tx) => {
      const target = this.requireUser(tx, input.id)
      this.assertCanManage(tx, auth, target.id)
      tx.update(users)
        .set({
          passwordHash,
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: new Date(),
          ...markModified(users)
        })
        .where(eq(users.id, target.id))
        .run()
      this.audit.record(
        {
          action: 'user.password_reset',
          userId: auth.userId,
          username: auth.username,
          entityType: 'user',
          entityId: target.id,
          details: { targetUsername: target.username }
        },
        tx
      )
    })
    this.auth.revokeUserSessions(input.id, 'PASSWORD_RESET')
  }

  private getMember(id: string): StaffMember {
    const row = this.requireUser(this.db, id)
    return this.toMember(row, this.rolesByUser([id]).get(id) ?? [])
  }

  private requireUser(db: DbExecutor, id: string): UserRow {
    const row = db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .get()
    if (!row) throw new AppError('NOT_FOUND', 'That staff member no longer exists.')
    return row
  }

  /** Roles must exist, and none may carry more access than the person assigning them. */
  private assertAssignable(db: DbExecutor, auth: AuthContext, roleIds: readonly string[]): void {
    const unique = [...new Set(roleIds)]
    const found = db
      .select({ id: roles.id })
      .from(roles)
      .where(and(inArray(roles.id, unique), isNull(roles.deletedAt)))
      .all()
    if (found.length !== unique.length) {
      throw new AppError('NOT_FOUND', 'One of the selected roles no longer exists.')
    }
    for (const codes of loadRolePermissions(db, unique).values()) assertHoldsAll(auth, codes)
  }

  /** You cannot manage an account that has more access than you do (e.g. the owner). */
  private assertCanManage(db: DbExecutor, auth: AuthContext, targetId: string): void {
    const target = loadAccess(db, targetId)
    if ([...target.permissions].some((code) => !auth.permissions.has(code))) {
      throw new AppError(
        'FORBIDDEN',
        'You cannot manage an account that has more access than yours.'
      )
    }
  }

  /** There must always be at least one active owner, or nobody could administer the system. */
  private assertOwnerRemains(
    db: DbExecutor,
    target: UserRow,
    willBeActive: boolean,
    newRoleIds: readonly string[]
  ): void {
    const ownerRole = db
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(eq(roles.name, OWNER_ROLE_NAME), eq(roles.isSystem, true), isNull(roles.deletedAt))
      )
      .get()
    if (!ownerRole) return

    const isOwnerNow = loadAccess(db, target.id).roles.some((role) => role.id === ownerRole.id)
    const willBeOwner = willBeActive && newRoleIds.includes(ownerRole.id)
    if (!(target.isActive && isOwnerNow) || willBeOwner) return

    const otherOwners =
      db
        .select({ count: sql<number>`count(*)` })
        .from(userRoles)
        .innerJoin(users, eq(userRoles.userId, users.id))
        .where(
          and(
            eq(userRoles.roleId, ownerRole.id),
            eq(users.isActive, true),
            isNull(users.deletedAt),
            sql`${users.id} <> ${target.id}`
          )
        )
        .get()?.count ?? 0
    if (otherOwners === 0) {
      throw new AppError('CONFLICT', 'There must always be at least one active owner.')
    }
  }

  private rolesByUser(userIds: readonly string[]): Map<string, RoleRef[]> {
    const result = new Map<string, RoleRef[]>()
    if (userIds.length === 0) return result
    const rows = this.db
      .select({ userId: userRoles.userId, id: roles.id, name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(inArray(userRoles.userId, [...userIds]), isNull(roles.deletedAt)))
      .orderBy(roles.name)
      .all()
    for (const row of rows) {
      const list = result.get(row.userId) ?? []
      list.push({ id: row.id, name: row.name })
      result.set(row.userId, list)
    }
    return result
  }

  private toMember(row: UserRow, memberRoles: RoleRef[]): StaffMember {
    return {
      id: row.id,
      username: row.username,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      isActive: row.isActive,
      mustChangePassword: row.mustChangePassword,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      lockedUntil:
        row.lockedUntil && row.lockedUntil.getTime() > Date.now()
          ? row.lockedUntil.toISOString()
          : null,
      createdAt: row.createdAt.toISOString(),
      roles: memberRoles
    }
  }
}
