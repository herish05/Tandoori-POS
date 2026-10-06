import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  changePasswordInputSchema,
  createRoleInputSchema,
  createStaffInputSchema,
  restaurantInputSchema,
  setupInputSchema
} from '@shared/auth-schemas'
import type { PermissionCode } from '@shared/permissions'
import { PERMISSION_CODES } from '@shared/permissions'
import { syncPermissionCatalog } from '@main/auth/permission-catalog'
import type { AuthContext } from '@main/auth/types'
import {
  completeSetup,
  createTestApp,
  failureCode,
  loginAsOwner,
  OWNER_PASSWORD,
  SETUP_INPUT,
  type TestApp
} from './helpers'

const STAFF_PASSWORD = 'Biryani-2026'

describe('first-owner setup', () => {
  let app: TestApp
  beforeEach(() => {
    app = createTestApp()
  })
  afterEach(() => {
    app.cleanup()
  })

  it('starts out not set up', () => {
    expect(app.services.setup.getStatus()).toEqual({
      isSetupComplete: false,
      restaurantName: null
    })
  })

  it('creates the restaurant, the OWNER role and the owner account together', async () => {
    await completeSetup(app)

    expect(app.services.setup.getStatus()).toEqual({
      isSetupComplete: true,
      restaurantName: 'Test Kitchen'
    })
    const profile = app.services.restaurant.get()
    expect(profile).toMatchObject({
      name: 'Test Kitchen',
      city: 'Testville',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      gstin: '03ABCDE1234F1Z5'
    })

    const roles = app.services.roles.list()
    expect(roles).toHaveLength(1)
    expect(roles[0]).toMatchObject({ name: 'OWNER', isSystem: true, userCount: 1 })
    expect(roles[0]?.permissions).toEqual([...PERMISSION_CODES])

    const log = app.services.audit.list({ page: 1, pageSize: 25 })
    expect(log.items.map((e) => e.action)).toContain('setup.completed')
  })

  it('can only be completed once', async () => {
    await completeSetup(app)
    expect(await failureCode(() => completeSetup(app))).toBe('ALREADY_SETUP')
    expect(app.services.users.list()).toHaveLength(1)
  })

  it('lets only one of two simultaneous attempts through', async () => {
    const results = await Promise.allSettled([completeSetup(app), completeSetup(app)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(app.services.users.list()).toHaveLength(1)
  })

  it('lets the new owner sign in straight afterwards', async () => {
    await completeSetup(app)
    const session = await loginAsOwner(app)
    expect(session.user.roles.map((r) => r.name)).toEqual(['OWNER'])
  })

  describe('input validation', () => {
    const base = () => structuredClone(SETUP_INPUT)

    it('accepts the sample input and defaults INR / Asia/Kolkata', () => {
      const parsed = setupInputSchema.parse(SETUP_INPUT)
      expect(parsed.restaurant.currency).toBe('INR')
      expect(parsed.restaurant.timezone).toBe('Asia/Kolkata')
      expect(parsed.owner.username).toBe('owner')
    })

    it('rejects mismatched passwords', () => {
      const input = base()
      input.owner.confirmPassword = 'Different-Pass1'
      expect(setupInputSchema.safeParse(input).success).toBe(false)
    })

    it('rejects weak passwords and a password equal to the username', () => {
      const short = base()
      short.owner.password = short.owner.confirmPassword = 'abc1'
      expect(setupInputSchema.safeParse(short).success).toBe(false)

      const noDigit = base()
      noDigit.owner.password = noDigit.owner.confirmPassword = 'onlyletterspassword'
      expect(setupInputSchema.safeParse(noDigit).success).toBe(false)

      const sameAsUser = base()
      sameAsUser.owner.username = 'owner12345'
      sameAsUser.owner.password = sameAsUser.owner.confirmPassword = 'owner12345'
      expect(setupInputSchema.safeParse(sameAsUser).success).toBe(false)
    })

    it('rejects a malformed GSTIN, phone, email and any currency but INR', () => {
      for (const patch of [
        { gstin: 'NOT-A-GSTIN' },
        { phone: 'abc' },
        { email: 'no-at-sign' },
        { currency: 'USD' },
        { timezone: 'Mars/Olympus' }
      ]) {
        const input = base()
        Object.assign(input.restaurant, patch)
        expect(setupInputSchema.safeParse(input).success).toBe(false)
      }
    })

    it('turns blank optional fields into null', () => {
      const input = base()
      Object.assign(input.restaurant, { legalName: '  ', gstin: '', email: '', receiptFooter: '' })
      const parsed = restaurantInputSchema.parse(input.restaurant)
      expect(parsed).toMatchObject({
        legalName: null,
        gstin: null,
        email: null,
        receiptFooter: null
      })
    })
  })
})

describe('staff, roles and permissions', () => {
  let app: TestApp
  let owner: AuthContext

  const makeRole = (name: string, permissions: PermissionCode[]) =>
    app.services.roles.create(owner, createRoleInputSchema.parse({ name, permissions }))

  const makeStaff = async (username: string, roleIds: string[]) =>
    app.services.users.create(
      owner,
      createStaffInputSchema.parse({
        username,
        password: STAFF_PASSWORD,
        fullName: `Staff ${username}`,
        roleIds
      })
    )

  const signInAs = async (username: string): Promise<AuthContext> => {
    app.services.auth.logout()
    await app.services.auth.login({ username, password: STAFF_PASSWORD })
    return app.services.auth.authorize([], { allowPasswordChange: true })
  }

  const finishPasswordChange = async (ctx: AuthContext, next = 'Fresh-Password-9') => {
    await app.services.auth.changePassword(ctx, {
      currentPassword: STAFF_PASSWORD,
      newPassword: next,
      confirmPassword: next
    })
  }

  beforeEach(async () => {
    app = createTestApp()
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
  })
  afterEach(() => {
    app.cleanup()
  })

  it('creates a role and staff on it; the new user must change their password first', async () => {
    const cashier = makeRole('Cashier', ['pos.access'])
    expect(cashier.permissions).toEqual(['pos.access'])
    const member = await makeStaff('cashier1', [cashier.id])
    expect(member).toMatchObject({ username: 'cashier1', isActive: true, mustChangePassword: true })

    const ctx = await signInAs('cashier1')
    expect(await failureCode(() => app.services.auth.authorize([]))).toBe(
      'PASSWORD_CHANGE_REQUIRED'
    )

    await finishPasswordChange(ctx)
    expect(app.services.auth.authorize(['pos.access']).username).toBe('cashier1')
  })

  it('rejects a password change that reuses the old password or has a wrong current one', async () => {
    const cashier = makeRole('Cashier', ['pos.access'])
    await makeStaff('cashier1', [cashier.id])
    const ctx = await signInAs('cashier1')

    expect(
      await failureCode(() =>
        app.services.auth.changePassword(ctx, {
          currentPassword: 'wrong-current-1',
          newPassword: 'Fresh-Password-9',
          confirmPassword: 'Fresh-Password-9'
        })
      )
    ).toBe('INVALID_CREDENTIALS')
    // Re-using the old password is rejected by the shared validation schema.
    expect(
      changePasswordInputSchema.safeParse({
        currentPassword: STAFF_PASSWORD,
        newPassword: STAFF_PASSWORD,
        confirmPassword: STAFF_PASSWORD
      }).success
    ).toBe(false)
  })

  it('denies access a role does not include, and audits the denial', async () => {
    const cashier = makeRole('Cashier', ['pos.access'])
    await makeStaff('cashier1', [cashier.id])
    await finishPasswordChange(await signInAs('cashier1'))

    expect(app.services.auth.authorize(['pos.access']).username).toBe('cashier1')
    expect(await failureCode(() => app.services.auth.authorize(['users.view']))).toBe('FORBIDDEN')
    expect(await failureCode(() => app.services.auth.authorize(['pos.access', 'audit.view']))).toBe(
      'FORBIDDEN'
    )

    const denied = app.services.audit
      .list({ page: 1, pageSize: 25, actionPrefix: 'auth.permission' })
      .items.at(0)
    expect(denied).toMatchObject({ outcome: 'FAILURE', username: 'cashier1' })
  })

  it('applies a role change immediately to people who are already signed in', async () => {
    const cashier = makeRole('Cashier', ['pos.access'])
    await makeStaff('cashier1', [cashier.id])
    await finishPasswordChange(await signInAs('cashier1'))
    expect(await failureCode(() => app.services.auth.authorize(['kitchen.access']))).toBe(
      'FORBIDDEN'
    )

    app.services.roles.update(owner, {
      id: cashier.id,
      name: 'Cashier',
      description: null,
      permissions: ['pos.access', 'kitchen.access']
    })
    expect(app.services.auth.authorize(['kitchen.access']).username).toBe('cashier1')
  })

  it('implies view when manage is granted', () => {
    const role = makeRole('Staff manager', ['users.manage'])
    expect(role.permissions).toEqual(expect.arrayContaining(['users.manage', 'users.view']))
  })

  it('does not let a manager hand out access they do not hold', async () => {
    const manager = makeRole('Manager', [
      'admin.access',
      'pos.access',
      'users.manage',
      'roles.manage'
    ])
    const cashier = makeRole('Cashier', ['pos.access'])
    await makeStaff('manager1', [manager.id])
    await finishPasswordChange(await signInAs('manager1'))
    const ctx = app.services.auth.authorize(['users.manage'])

    // Cannot grant a permission the manager lacks (audit.view).
    expect(
      await failureCode(() =>
        app.services.roles.create(
          ctx,
          createRoleInputSchema.parse({ name: 'Auditor', permissions: ['audit.view'] })
        )
      )
    ).toBe('FORBIDDEN')

    // Cannot assign the OWNER role, nor touch an owner's account.
    const ownerRole = app.services.roles.list().find((r) => r.name === 'OWNER')
    expect(
      await failureCode(() =>
        app.services.users.create(
          ctx,
          createStaffInputSchema.parse({
            username: 'sneaky',
            password: STAFF_PASSWORD,
            fullName: 'Sneaky Person',
            roleIds: [ownerRole?.id]
          })
        )
      )
    ).toBe('FORBIDDEN')
    expect(
      await failureCode(() =>
        app.services.users.resetPassword(ctx, { id: owner.userId, newPassword: 'Hijacked-Pass1' })
      )
    ).toBe('FORBIDDEN')

    // But can manage people within their own level.
    const created = await app.services.users.create(
      ctx,
      createStaffInputSchema.parse({
        username: 'cashier2',
        password: STAFF_PASSWORD,
        fullName: 'Second Cashier',
        roleIds: [cashier.id]
      })
    )
    expect(created.roles.map((r) => r.name)).toEqual(['Cashier'])
  })

  it('protects the built-in OWNER role and roles that are in use', async () => {
    const ownerRole = app.services.roles.list().find((r) => r.name === 'OWNER')
    expect(
      await failureCode(() =>
        app.services.roles.update(owner, {
          id: ownerRole?.id ?? '',
          name: 'OWNER',
          description: null,
          permissions: ['pos.access']
        })
      )
    ).toBe('CONFLICT')
    expect(
      await failureCode(() => {
        app.services.roles.delete(owner, ownerRole?.id ?? '')
      })
    ).toBe('CONFLICT')

    const cashier = makeRole('Cashier', ['pos.access'])
    await makeStaff('cashier1', [cashier.id])
    expect(
      await failureCode(() => {
        app.services.roles.delete(owner, cashier.id)
      })
    ).toBe('CONFLICT')

    const spare = makeRole('Spare', [])
    app.services.roles.delete(owner, spare.id)
    expect(app.services.roles.list().map((r) => r.name)).not.toContain('Spare')
  })

  it('rejects duplicate usernames and role names', async () => {
    const cashier = makeRole('Cashier', ['pos.access'])
    await makeStaff('cashier1', [cashier.id])
    expect(await failureCode(() => makeStaff('CASHIER1', [cashier.id]))).toBe('CONFLICT')
    expect(await failureCode(() => makeRole('cashier', []))).toBe('CONFLICT')
  })

  it('cannot deactivate or re-role your own account', async () => {
    const me = app.services.users.list().find((u) => u.id === owner.userId)
    expect(me).toBeDefined()
    const update = {
      id: owner.userId,
      fullName: 'Olivia Owner',
      email: null,
      phone: null,
      roleIds: me?.roles.map((r) => r.id) ?? [],
      isActive: false
    }
    const code = await failureCode(() => app.services.users.update(owner, update))
    expect(code).toBe('CONFLICT')
  })

  it('a deactivated person is signed out and cannot sign back in', async () => {
    const cashier = makeRole('Cashier', ['pos.access'])
    const member = await makeStaff('cashier1', [cashier.id])
    await finishPasswordChange(await signInAs('cashier1'))
    expect(app.services.auth.peek().session?.user.username).toBe('cashier1')

    // The owner deactivates them (owner is not the signed-in handle in this service, which is
    // fine: sessions are revoked by user id).
    app.services.users.update(owner, {
      id: member.id,
      fullName: member.fullName,
      email: null,
      phone: null,
      roleIds: [cashier.id],
      isActive: false
    })

    expect(app.services.auth.peek().session).toBeNull()
    expect(
      await failureCode(() =>
        app.services.auth.login({ username: 'cashier1', password: 'Fresh-Password-9' })
      )
    ).toBe('ACCOUNT_DISABLED')
  })

  it('resets a password: the old one stops working and a new change is forced', async () => {
    const cashier = makeRole('Cashier', ['pos.access'])
    const member = await makeStaff('cashier1', [cashier.id])
    await finishPasswordChange(await signInAs('cashier1'))

    await app.services.users.resetPassword(owner, { id: member.id, newPassword: 'Reset-Pass-55' })

    expect(app.services.auth.peek().session).toBeNull()
    expect(
      await failureCode(() =>
        app.services.auth.login({ username: 'cashier1', password: 'Fresh-Password-9' })
      )
    ).toBe('INVALID_CREDENTIALS')
    const session = await app.services.auth.login({
      username: 'cashier1',
      password: 'Reset-Pass-55'
    })
    expect(session.user.mustChangePassword).toBe(true)
    // The owner cannot use this to change their own password.
    expect(
      await failureCode(() =>
        app.services.users.resetPassword(owner, { id: owner.userId, newPassword: 'Another-Pass-1' })
      )
    ).toBe('CONFLICT')
  })

  it('keeps the permission catalog in step with the code and re-grants OWNER', () => {
    app.handle.sqlite
      .prepare(
        "DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'audit.view')"
      )
      .run()
    app.handle.sqlite.prepare("DELETE FROM permissions WHERE code = 'audit.view'").run()

    syncPermissionCatalog(app.handle.db)

    const ownerRole = app.services.roles.list().find((r) => r.name === 'OWNER')
    expect(ownerRole?.permissions).toEqual([...PERMISSION_CODES])
    // Running it again changes nothing.
    syncPermissionCatalog(app.handle.db)
    expect(app.services.roles.list().find((r) => r.name === 'OWNER')?.permissions).toEqual([
      ...PERMISSION_CODES
    ])
  })

  it('records restaurant changes in the audit log by field name, never by value', () => {
    const current = app.services.restaurant.get()
    app.services.restaurant.update(
      owner,
      restaurantInputSchema.parse({
        ...current,
        phone: '+91 99999 11111',
        receiptFooter: 'See you soon'
      })
    )
    expect(app.services.restaurant.get().receiptFooter).toBe('See you soon')

    const entry = app.services.audit
      .list({ page: 1, pageSize: 25, actionPrefix: 'restaurant.' })
      .items.at(0)
    const changed = entry?.details?.changedFields as string[] | undefined
    expect(changed).toEqual(expect.arrayContaining<string>(['phone', 'receiptFooter']))
    expect(JSON.stringify(entry)).not.toContain('99999')
  })

  it('filters and pages the audit log', async () => {
    await failureCode(() => app.services.auth.login({ username: 'owner', password: 'wrong-pass1' }))
    await loginAsOwner(app)

    const failures = app.services.audit.list({ page: 1, pageSize: 10, outcome: 'FAILURE' })
    expect(failures.items.length).toBeGreaterThan(0)
    expect(failures.items.every((e) => e.outcome === 'FAILURE')).toBe(true)

    const first = app.services.audit.list({ page: 1, pageSize: 10 })
    expect(first.total).toBeGreaterThanOrEqual(first.items.length)
    // Newest first.
    const times = first.items.map((e) => e.createdAt)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it('never writes secrets into audit details', async () => {
    const cashier = makeRole('Cashier', ['pos.access'])
    await makeStaff('cashier1', [cashier.id])
    const dump = JSON.stringify(app.services.audit.list({ page: 1, pageSize: 100 }))
    expect(dump).not.toContain(STAFF_PASSWORD)
    expect(dump).not.toContain(OWNER_PASSWORD)
    expect(dump).not.toMatch(/scrypt\$/)
  })
})
