import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { baseColumns, SYNC_STATUSES } from './common'

/** The restaurant this installation belongs to. Exactly one row exists after first-time setup. */
export const restaurants = sqliteTable('restaurants', {
  ...baseColumns(),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  address: text('address').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  country: text('country').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  gstin: text('gstin'),
  currency: text('currency').notNull().default('INR'),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  receiptFooter: text('receipt_footer'),
  /** PNG/JPEG/WebP data URL (size-limited by validation). */
  logo: text('logo')
})

/** Catalogue of things a role can allow. Rows are written from the code catalogue at startup. */
export const permissions = sqliteTable(
  'permissions',
  {
    ...baseColumns(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    groupName: text('group_name').notNull(),
    description: text('description').notNull()
  },
  (table) => [uniqueIndex('permissions_code_unique').on(table.code)]
)

export const roles = sqliteTable(
  'roles',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    name: text('name').notNull(),
    description: text('description'),
    /** System roles (OWNER) cannot be edited or deleted. */
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    uniqueIndex('roles_restaurant_name_unique')
      .on(table.restaurantId, table.name)
      .where(sql`${table.deletedAt} is null`)
  ]
)

/**
 * Join tables are part of their parent's aggregate: rows are removed outright and the parent
 * (role / user) is marked modified, so a sync sends the complete, current set.
 */
export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => [uniqueIndex('role_permissions_unique').on(table.roleId, table.permissionId)]
)

export const users = sqliteTable(
  'users',
  {
    ...baseColumns(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    /** Always stored lower-case. */
    username: text('username').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    /** `scrypt$N$r$p$salt$hash`. The password itself is never stored. */
    passwordHash: text('password_hash').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
    passwordChangedAt: integer('password_changed_at', { mode: 'timestamp_ms' })
  },
  (table) => [
    uniqueIndex('users_username_unique')
      .on(table.username)
      .where(sql`${table.deletedAt} is null`)
  ]
)

export const userRoles = sqliteTable(
  'user_roles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => [uniqueIndex('user_roles_unique').on(table.userId, table.roleId)]
)

/**
 * Sign-in sessions of this device. Local only (never synchronised). The session id is a random
 * UUID that stays inside the main process; the renderer never holds a credential.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: text('device_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastActivityAt: integer('last_activity_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    revokeReason: text('revoke_reason')
  },
  (table) => [index('sessions_user_idx').on(table.userId)]
)

/** Append-only record of security-relevant events. Rows are never updated or deleted. */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    action: text('action').notNull(),
    outcome: text('outcome', { enum: ['SUCCESS', 'FAILURE'] })
      .notNull()
      .default('SUCCESS'),
    userId: text('user_id'),
    /** Snapshot of the name used, so the entry stays readable if the user changes later. */
    username: text('username'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** JSON text. Never contains passwords or other secrets. */
    details: text('details'),
    deviceId: text('device_id'),
    syncStatus: text('sync_status', { enum: SYNC_STATUSES }).notNull().default('PENDING')
  },
  (table) => [
    index('audit_logs_created_idx').on(table.createdAt),
    index('audit_logs_action_idx').on(table.action)
  ]
)
