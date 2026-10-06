import { and, eq, isNull, sql } from 'drizzle-orm'
import type { ChangePasswordData, LoginData } from '@shared/auth-schemas'
import type { SessionInfo, SessionSnapshot } from '@shared/domain'
import { PERMISSION_CODES, type PermissionCode } from '@shared/permissions'
import type { AppDatabase } from '../db/client'
import { markModified, sessions, users } from '../db/schema'
import { AppError } from '../ipc/errors'
import type { Logger } from '../logging/log-manager'
import { loadAccess } from './access'
import type { AuditService } from './audit-service'
import { getDummyHash, hashPassword, verifyPassword } from './password'
import type { AuthContext, AuthorizeOptions, Clock } from './types'

export interface AuthOptions {
  /** A session never lasts longer than this, however active the user is. */
  absoluteTtlMs: number
  /** A session ends after this long without any activity. */
  idleTtlMs: number
  maxFailedAttempts: number
  lockoutMs: number
  /** Activity is written to the database at most this often. */
  activityWriteIntervalMs: number
}

export const DEFAULT_AUTH_OPTIONS: AuthOptions = {
  absoluteTtlMs: 12 * 60 * 60 * 1000,
  idleTtlMs: 30 * 60 * 1000,
  maxFailedAttempts: 5,
  lockoutMs: 5 * 60 * 1000,
  activityWriteIntervalMs: 10 * 1000
}

type SessionRow = typeof sessions.$inferSelect
type UserRow = typeof users.$inferSelect
type ExpiryReason = 'idle' | 'absolute'

type Validation =
  | { state: 'active'; session: SessionRow; user: UserRow }
  | { state: 'none' }
  | { state: 'expired'; reason: ExpiryReason }

export interface AuthServiceDeps {
  db: AppDatabase
  audit: AuditService
  logger: Logger
  deviceId: string | null
  clock?: Clock
  options?: Partial<AuthOptions>
}

/**
 * Local authentication and session management.
 *
 * - Everything works offline: credentials and sessions live in the local database.
 * - The session handle lives only in main-process memory; the renderer never holds a credential,
 *   so there is nothing for injected script to steal. After an app restart nobody is signed in.
 * - Permissions are read from the database on every protected call, so changing a role takes
 *   effect immediately.
 */
export class AuthService {
  private readonly db: AppDatabase
  private readonly audit: AuditService
  private readonly logger: Logger
  private readonly deviceId: string | null
  private readonly clock: Clock
  private readonly options: AuthOptions
  private currentSessionId: string | null = null
  private lastActivityWrite = { sessionId: '', at: 0 }

  constructor(deps: AuthServiceDeps) {
    this.db = deps.db
    this.audit = deps.audit
    this.logger = deps.logger
    this.deviceId = deps.deviceId
    this.clock = deps.clock ?? Date.now
    this.options = { ...DEFAULT_AUTH_OPTIONS, ...deps.options }
  }

  /** Sessions cannot survive a restart (the handle was in memory), so close any left open. */
  revokeStaleSessions(): void {
    this.db
      .update(sessions)
      .set({ revokedAt: new Date(this.clock()), revokeReason: 'APP_RESTART' })
      .where(isNull(sessions.revokedAt))
      .run()
  }

  async login(input: LoginData): Promise<SessionInfo> {
    const username = input.username
    const now = this.clock()
    const user = this.db
      .select()
      .from(users)
      .where(and(eq(users.username, username), isNull(users.deletedAt)))
      .get()

    if (!user) {
      // Same work as a real check, so response time does not reveal which usernames exist.
      await verifyPassword(input.password, await getDummyHash())
      this.failLogin(null, username, 'unknown_user')
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect username or password.')
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > now) {
      this.failLogin(user, username, 'locked')
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now) / 60_000))
      throw new AppError(
        'ACCOUNT_LOCKED',
        `Too many incorrect attempts. Try again in ${String(minutes)} minute${minutes === 1 ? '' : 's'}, or ask the owner to reset your password.`
      )
    }

    const passwordOk = await verifyPassword(input.password, user.passwordHash)
    if (!passwordOk) {
      this.registerFailedAttempt(user)
      this.failLogin(user, username, 'wrong_password')
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect username or password.')
    }

    if (!user.isActive) {
      this.failLogin(user, username, 'inactive')
      throw new AppError(
        'ACCOUNT_DISABLED',
        'This account has been deactivated. Please contact the owner.'
      )
    }

    // Only one person is signed in on a terminal at a time.
    if (this.currentSessionId) this.endSession(this.currentSessionId, 'REPLACED')

    const startedAt = this.clock()
    const sessionId = this.db.transaction((tx) => {
      const row = tx
        .insert(sessions)
        .values({
          userId: user.id,
          deviceId: this.deviceId,
          createdAt: new Date(startedAt),
          lastActivityAt: new Date(startedAt),
          expiresAt: new Date(startedAt + this.options.absoluteTtlMs)
        })
        .returning()
        .get()
      tx.update(users)
        .set({
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(startedAt),
          ...markModified(users)
        })
        .where(eq(users.id, user.id))
        .run()
      this.audit.record(
        {
          action: 'auth.login',
          userId: user.id,
          username: user.username,
          entityType: 'session',
          entityId: row.id
        },
        tx
      )
      return row.id
    })

    this.currentSessionId = sessionId
    this.lastActivityWrite = { sessionId, at: startedAt }
    this.logger.info('User signed in', { userId: user.id })

    const session = this.requireSession(sessionId)
    const fresh = this.requireUser(user.id)
    return this.toSessionInfo(session, fresh)
  }

  logout(): void {
    const id = this.currentSessionId
    if (!id) return
    const session = this.db.select().from(sessions).where(eq(sessions.id, id)).get()
    this.currentSessionId = null
    if (!session || session.revokedAt) return

    const user = this.db.select().from(users).where(eq(users.id, session.userId)).get()
    this.db
      .update(sessions)
      .set({ revokedAt: new Date(this.clock()), revokeReason: 'LOGOUT' })
      .where(eq(sessions.id, id))
      .run()
    this.audit.recordSafe({
      action: 'auth.logout',
      userId: session.userId,
      username: user?.username ?? null,
      entityType: 'session',
      entityId: id
    })
    this.logger.info('User signed out', { userId: session.userId })
  }

  /** Who is signed in? Does not count as activity, so polling cannot keep a session alive. */
  peek(): SessionSnapshot {
    const state = this.validate()
    if (state.state === 'active') {
      return { session: this.toSessionInfo(state.session, state.user), expired: false }
    }
    return { session: null, expired: state.state === 'expired' }
  }

  /**
   * The permission middleware. Every protected IPC handler goes through this:
   * it requires a live session, records activity, and requires every listed permission.
   */
  authorize(required: readonly PermissionCode[], options: AuthorizeOptions = {}): AuthContext {
    const state = this.validate()
    if (state.state === 'expired') {
      throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.')
    }
    if (state.state === 'none') {
      throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.')
    }

    this.recordActivity(state.session)
    if (state.user.mustChangePassword && !options.allowPasswordChange) {
      throw new AppError('PASSWORD_CHANGE_REQUIRED', 'You must choose a new password first.')
    }

    const access = loadAccess(this.db, state.user.id)
    const missing = required.filter((code) => !access.permissions.has(code))
    if (missing.length > 0) {
      this.audit.recordSafe({
        action: 'auth.permission_denied',
        outcome: 'FAILURE',
        userId: state.user.id,
        username: state.user.username,
        details: { required: [...required], missing }
      })
      this.logger.warn('Permission denied', { userId: state.user.id, missing })
      throw new AppError('FORBIDDEN', 'You do not have permission to do this.')
    }

    return {
      userId: state.user.id,
      username: state.user.username,
      fullName: state.user.fullName,
      sessionId: state.session.id,
      roles: access.roles,
      permissions: access.permissions
    }
  }

  async changePassword(auth: AuthContext, input: ChangePasswordData): Promise<SessionInfo> {
    const user = this.requireUser(auth.userId)
    const ok = await verifyPassword(input.currentPassword, user.passwordHash)
    if (!ok) {
      this.audit.recordSafe({
        action: 'auth.password_changed',
        outcome: 'FAILURE',
        userId: user.id,
        username: user.username,
        details: { reason: 'wrong_current_password' }
      })
      throw new AppError('INVALID_CREDENTIALS', 'The current password is not correct.')
    }

    const passwordHash = await hashPassword(input.newPassword)
    this.db.transaction((tx) => {
      tx.update(users)
        .set({
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(this.clock()),
          ...markModified(users)
        })
        .where(eq(users.id, user.id))
        .run()
      this.audit.record(
        { action: 'auth.password_changed', userId: user.id, username: user.username },
        tx
      )
    })

    return this.toSessionInfo(this.requireSession(auth.sessionId), this.requireUser(user.id))
  }

  /** Ends every open session of a user (deactivation, password reset). */
  revokeUserSessions(userId: string, reason: string): void {
    this.db
      .update(sessions)
      .set({ revokedAt: new Date(this.clock()), revokeReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .run()
  }

  /** Number of open sessions (used by diagnostics and tests). */
  openSessionCount(): number {
    return (
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(sessions)
        .where(isNull(sessions.revokedAt))
        .get()?.count ?? 0
    )
  }

  private validate(): Validation {
    const id = this.currentSessionId
    if (!id) return { state: 'none' }

    const session = this.db.select().from(sessions).where(eq(sessions.id, id)).get()
    if (!session || session.revokedAt) {
      this.currentSessionId = null
      return { state: 'none' }
    }

    const now = this.clock()
    if (now >= session.expiresAt.getTime()) return this.expire(session, 'absolute')
    if (now - session.lastActivityAt.getTime() >= this.options.idleTtlMs) {
      return this.expire(session, 'idle')
    }

    const user = this.db.select().from(users).where(eq(users.id, session.userId)).get()
    if (!user || user.deletedAt || !user.isActive) {
      this.endSession(id, 'USER_DISABLED')
      return { state: 'none' }
    }
    return { state: 'active', session, user }
  }

  private expire(session: SessionRow, reason: ExpiryReason): Validation {
    const user = this.db.select().from(users).where(eq(users.id, session.userId)).get()
    this.db
      .update(sessions)
      .set({
        revokedAt: new Date(this.clock()),
        revokeReason: reason === 'idle' ? 'EXPIRED_IDLE' : 'EXPIRED_ABSOLUTE'
      })
      .where(eq(sessions.id, session.id))
      .run()
    this.currentSessionId = null
    this.audit.recordSafe({
      action: 'auth.session_expired',
      userId: session.userId,
      username: user?.username ?? null,
      entityType: 'session',
      entityId: session.id,
      details: { reason }
    })
    return { state: 'expired', reason }
  }

  private endSession(sessionId: string, reason: string): void {
    this.db
      .update(sessions)
      .set({ revokedAt: new Date(this.clock()), revokeReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .run()
    if (this.currentSessionId === sessionId) this.currentSessionId = null
  }

  private recordActivity(session: SessionRow): void {
    const now = this.clock()
    const last = this.lastActivityWrite
    if (last.sessionId === session.id && now - last.at < this.options.activityWriteIntervalMs) {
      return
    }
    this.db
      .update(sessions)
      .set({ lastActivityAt: new Date(now) })
      .where(eq(sessions.id, session.id))
      .run()
    this.lastActivityWrite = { sessionId: session.id, at: now }
  }

  private registerFailedAttempt(user: UserRow): void {
    const now = this.clock()
    const attempts = user.failedLoginAttempts + 1
    const lock = attempts >= this.options.maxFailedAttempts
    this.db
      .update(users)
      .set({
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(now + this.options.lockoutMs) : user.lockedUntil
      })
      .where(eq(users.id, user.id))
      .run()
    if (lock) {
      this.audit.recordSafe({
        action: 'auth.account_locked',
        outcome: 'FAILURE',
        userId: user.id,
        username: user.username,
        details: { lockoutMinutes: Math.round(this.options.lockoutMs / 60_000) }
      })
      this.logger.warn('Account locked after repeated failures', { userId: user.id })
    }
  }

  private failLogin(user: UserRow | null, username: string, reason: string): void {
    this.audit.recordSafe({
      action: 'auth.login_failed',
      outcome: 'FAILURE',
      userId: user?.id ?? null,
      username: username.slice(0, 64),
      details: { reason }
    })
    this.logger.warn('Sign-in failed', { username: username.slice(0, 64), reason })
  }

  private requireSession(id: string): SessionRow {
    const row = this.db.select().from(sessions).where(eq(sessions.id, id)).get()
    if (!row) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.')
    return row
  }

  private requireUser(id: string): UserRow {
    const row = this.db.select().from(users).where(eq(users.id, id)).get()
    if (!row) throw new AppError('NOT_FOUND', 'That account no longer exists.')
    return row
  }

  private toSessionInfo(session: SessionRow, user: UserRow): SessionInfo {
    const access = loadAccess(this.db, user.id)
    return {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        roles: access.roles,
        permissions: PERMISSION_CODES.filter((code) => access.permissions.has(code)),
        mustChangePassword: user.mustChangePassword
      },
      startedAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      idleTimeoutMinutes: Math.round(this.options.idleTtlMs / 60_000)
    }
  }
}
