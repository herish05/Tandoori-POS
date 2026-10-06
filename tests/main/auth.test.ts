import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSION_CODES } from '@shared/permissions'
import {
  completeSetup,
  createTestApp,
  failureCode,
  loginAsOwner,
  OWNER_PASSWORD,
  type TestApp
} from './helpers'

const MINUTE = 60_000

describe('authentication and sessions', () => {
  let app: TestApp
  beforeEach(async () => {
    app = createTestApp()
    await completeSetup(app)
  })
  afterEach(() => {
    app.cleanup()
  })

  it('signs the owner in with every permission and audits it', async () => {
    const session = await loginAsOwner(app)
    expect(session.user.username).toBe('owner')
    expect(session.user.roles.map((r) => r.name)).toEqual(['OWNER'])
    expect(session.user.permissions).toEqual([...PERMISSION_CODES])
    expect(session.user.mustChangePassword).toBe(false)

    const log = app.services.audit.list({ page: 1, pageSize: 25 })
    expect(log.items.map((e) => e.action)).toContain('auth.login')
  })

  it('treats the username case-insensitively', async () => {
    const session = await app.services.auth.login({ username: 'owner', password: OWNER_PASSWORD })
    expect(session.user.fullName).toBe('Olivia Owner')
  })

  it('rejects a wrong password without revealing which part was wrong', async () => {
    const wrongPassword = await failureCode(() =>
      app.services.auth.login({ username: 'owner', password: 'not-the-password1' })
    )
    const unknownUser = await failureCode(() =>
      app.services.auth.login({ username: 'nobody', password: 'not-the-password1' })
    )
    expect(wrongPassword).toBe('INVALID_CREDENTIALS')
    expect(unknownUser).toBe('INVALID_CREDENTIALS')
    expect(app.services.auth.peek().session).toBeNull()

    const failures = app.services.audit.list({ page: 1, pageSize: 25, outcome: 'FAILURE' })
    expect(failures.items.filter((e) => e.action === 'auth.login_failed')).toHaveLength(2)
  })

  it('locks the account after repeated failures, then lets it back in after the lockout', async () => {
    for (let i = 0; i < 5; i++) {
      await failureCode(() =>
        app.services.auth.login({ username: 'owner', password: 'wrong-pass1' })
      )
    }
    // Even the correct password is refused while locked.
    expect(await failureCode(() => loginAsOwner(app))).toBe('ACCOUNT_LOCKED')

    app.clock.advance(6 * MINUTE)
    const session = await loginAsOwner(app)
    expect(session.user.username).toBe('owner')

    const actions = app.services.audit.list({ page: 1, pageSize: 50 }).items.map((e) => e.action)
    expect(actions).toContain('auth.account_locked')
  })

  it('logs out: the session ends, access is refused and the logout is audited', async () => {
    await loginAsOwner(app)
    expect(app.services.auth.authorize([]).username).toBe('owner')

    app.services.auth.logout()

    expect(app.services.auth.peek().session).toBeNull()
    expect(await failureCode(() => app.services.auth.authorize([]))).toBe('UNAUTHENTICATED')
    expect(app.services.auth.openSessionCount()).toBe(0)
    const actions = app.services.audit.list({ page: 1, pageSize: 25 }).items.map((e) => e.action)
    expect(actions).toContain('auth.logout')
  })

  it('expires an idle session', async () => {
    await loginAsOwner(app)
    app.clock.advance(31 * MINUTE)

    expect(await failureCode(() => app.services.auth.authorize([]))).toBe('SESSION_EXPIRED')
    // Once expired, the user is simply signed out.
    expect(await failureCode(() => app.services.auth.authorize([]))).toBe('UNAUTHENTICATED')

    const expired = app.services.audit
      .list({ page: 1, pageSize: 25 })
      .items.find((e) => e.action === 'auth.session_expired')
    expect(expired?.details).toEqual({ reason: 'idle' })
  })

  it('keeps an active session alive, but not forever', async () => {
    await loginAsOwner(app)
    for (let i = 0; i < 4; i++) {
      app.clock.advance(20 * MINUTE)
      expect(app.services.auth.authorize([]).username).toBe('owner')
    }
    // Idle limit not hit (always < 30 min between calls); the 12 hour ceiling is.
    for (let i = 0; i < 40; i++) {
      app.clock.advance(20 * MINUTE)
      const code = await failureCode(() => app.services.auth.authorize([]))
      if (code) {
        expect(code).toBe('SESSION_EXPIRED')
        const entry = app.services.audit
          .list({ page: 1, pageSize: 25 })
          .items.find((e) => e.action === 'auth.session_expired')
        expect(entry?.details).toEqual({ reason: 'absolute' })
        return
      }
    }
    throw new Error('session never reached the absolute limit')
  })

  it('does not treat checking the session as activity', async () => {
    await loginAsOwner(app)
    app.clock.advance(20 * MINUTE)
    expect(app.services.auth.peek().session).not.toBeNull()
    app.clock.advance(20 * MINUTE)
    expect(app.services.auth.peek().session).toBeNull()
  })

  it('reports an expiry to the polling screen exactly once', async () => {
    await loginAsOwner(app)
    app.clock.advance(31 * MINUTE)
    expect(app.services.auth.peek()).toMatchObject({ session: null, expired: true })
    expect(app.services.auth.peek()).toMatchObject({ session: null, expired: false })
  })

  it('refuses protected calls when nobody is signed in', async () => {
    expect(await failureCode(() => app.services.auth.authorize(['users.view']))).toBe(
      'UNAUTHENTICATED'
    )
  })

  it('signs in with no network at all (offline login)', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is down')))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const session = await loginAsOwner(app)
      expect(session.user.username).toBe('owner')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ends sessions left open by a previous run', async () => {
    await loginAsOwner(app)
    expect(app.services.auth.openSessionCount()).toBe(1)

    const restarted = app.restart()
    expect(restarted.auth.openSessionCount()).toBe(0)
    expect(restarted.auth.peek().session).toBeNull()
  })

  it('never stores a password in plain text', async () => {
    await loginAsOwner(app)
    const hash = app.handle.sqlite
      .prepare('SELECT password_hash AS h FROM users WHERE username = ?')
      .get('owner') as { h: string }
    expect(hash.h.startsWith('scrypt$')).toBe(true)
    expect(hash.h).not.toContain(OWNER_PASSWORD)

    app.handle.sqlite.pragma('wal_checkpoint(TRUNCATE)')
    const file = readFileSync(app.handle.path)
    expect(file.includes(Buffer.from(OWNER_PASSWORD))).toBe(false)
    const audit = JSON.stringify(app.services.audit.list({ page: 1, pageSize: 100 }))
    expect(audit).not.toContain(OWNER_PASSWORD)
  })
})
