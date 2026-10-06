import type { PermissionCode } from '@shared/permissions'
import type { RoleRef } from '@shared/domain'

/** Milliseconds since the epoch. Injected so session timeouts can be tested without waiting. */
export type Clock = () => number

/** Who is making a request, as established by the session. Passed to every protected handler. */
export interface AuthContext {
  userId: string
  username: string
  fullName: string
  sessionId: string
  roles: RoleRef[]
  permissions: ReadonlySet<PermissionCode>
}

export interface AuthorizeOptions {
  /** Let a user whose password must be changed through (only the change-password call sets this). */
  allowPasswordChange?: boolean
}

export type Authorize = (
  required: readonly PermissionCode[],
  options?: AuthorizeOptions
) => AuthContext

export type AuditAction =
  | 'setup.completed'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.account_locked'
  | 'auth.logout'
  | 'auth.session_expired'
  | 'auth.password_changed'
  | 'auth.permission_denied'
  | 'user.created'
  | 'user.updated'
  | 'user.activated'
  | 'user.deactivated'
  | 'user.password_reset'
  | 'role.created'
  | 'role.updated'
  | 'role.deleted'
  | 'restaurant.updated'
  | 'area.created'
  | 'area.updated'
  | 'area.activated'
  | 'area.deactivated'
  | 'area.deleted'
  | 'table.created'
  | 'table.updated'
  | 'table.activated'
  | 'table.deactivated'
  | 'table.layout_updated'
  | 'table.opened'
  | 'table.closed'
  | 'table.blocked'
  | 'table.unblocked'
  | 'menu.station.created'
  | 'menu.station.updated'
  | 'menu.station.activated'
  | 'menu.station.deactivated'
  | 'menu.station.deleted'
  | 'menu.category.created'
  | 'menu.category.updated'
  | 'menu.category.activated'
  | 'menu.category.deactivated'
  | 'menu.category.deleted'
  | 'menu.tax.created'
  | 'menu.tax.updated'
  | 'menu.tax.activated'
  | 'menu.tax.deactivated'
  | 'menu.tax.deleted'
  | 'menu.addon.created'
  | 'menu.addon.updated'
  | 'menu.addon.activated'
  | 'menu.addon.deactivated'
  | 'menu.addon.deleted'
  | 'menu.item.created'
  | 'menu.item.updated'
  | 'menu.item.activated'
  | 'menu.item.deactivated'
  | 'menu.item.available'
  | 'menu.item.sold_out'
  | 'menu.item.deleted'
  | 'menu.demo.loaded'
  | 'menu.demo.removed'
  | 'order.created'
  | 'order.updated'
  | 'order.items_added'
  | 'order.item_updated'
  | 'order.item_removed'
  | 'order.item_cancelled'
  | 'order.sent'
  | 'order.status_changed'
  | 'order.cancelled'
