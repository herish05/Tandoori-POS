import type { PermissionCode } from './permissions'

/** Data shapes returned by the main process for restaurant, staff and security features. */

export interface RestaurantProfile {
  id: string
  name: string
  legalName: string | null
  address: string
  city: string
  state: string
  country: string
  phone: string
  email: string | null
  gstin: string | null
  currency: string
  timezone: string
  receiptFooter: string | null
  /** PNG/JPEG/WebP data URL, or null. */
  logo: string | null
}

export interface SetupStatus {
  isSetupComplete: boolean
  restaurantName: string | null
}

export interface RoleRef {
  id: string
  name: string
}

export interface SessionUser {
  id: string
  username: string
  fullName: string
  email: string | null
  roles: RoleRef[]
  permissions: PermissionCode[]
  mustChangePassword: boolean
}

export interface SessionInfo {
  user: SessionUser
  startedAt: string
  /** Hard limit: the session ends here no matter what. */
  expiresAt: string
  /** The session also ends after this many minutes without activity. */
  idleTimeoutMinutes: number
}

/** Result of asking "who is signed in?". `expired` is true once after a session timed out. */
export interface SessionSnapshot {
  session: SessionInfo | null
  expired: boolean
}

export interface StaffMember {
  id: string
  username: string
  fullName: string
  email: string | null
  phone: string | null
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  lockedUntil: string | null
  createdAt: string
  roles: RoleRef[]
}

export interface RoleSummary {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  permissions: PermissionCode[]
  userCount: number
}

export interface PermissionInfo {
  code: PermissionCode
  label: string
  group: string
  description: string
}

export type AuditOutcome = 'SUCCESS' | 'FAILURE'

export interface AuditLogEntry {
  id: string
  createdAt: string
  action: string
  outcome: AuditOutcome
  userId: string | null
  username: string | null
  entityType: string | null
  entityId: string | null
  details: Record<string, unknown> | null
}

export interface AuditLogPage {
  items: AuditLogEntry[]
  total: number
  page: number
  pageSize: number
}
