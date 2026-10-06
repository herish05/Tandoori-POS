import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { createTableInputSchema } from '@shared/tables'
import type { IpcResult } from '@shared/types'
import { registerAuthHandlers } from '@main/auth-handlers'
import { registerTableHandlers } from '@main/table-handlers'
import { createIpcRegistrar } from '@main/ipc/registrar'
import {
  completeSetup,
  createTestApp,
  loginAsOwner,
  OWNER_PASSWORD,
  silentLogger,
  type TestApp
} from './helpers'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, raw: unknown) => Promise<unknown>) => {
      electron.handlers.set(channel, fn)
    }
  }
}))

const trustedEvent = { senderFrame: { url: 'app://tandoori-pos/index.html' } }

async function invoke(channel: string, raw?: unknown) {
  const handler = electron.handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  const event = trustedEvent as unknown as IpcMainInvokeEvent
  return (await handler(event, raw)) as IpcResult<unknown>
}

const errorCode = (result: IpcResult<unknown>): string | null =>
  result.ok ? null : result.error.code

describe('IPC permission middleware', () => {
  let app: TestApp
  let trusted = true

  beforeEach(async () => {
    electron.handlers.clear()
    trusted = true
    app = createTestApp()
    await completeSetup(app)

    const registrar = createIpcRegistrar({
      logger: silentLogger,
      securityLogger: silentLogger,
      isTrustedSender: () => trusted,
      authorize: (required, options) => app.services.auth.authorize(required, options)
    })
    registerAuthHandlers(registrar, app.services)
    registerTableHandlers(registrar, app.services)
  })
  afterEach(() => {
    app.cleanup()
  })

  it('answers public calls without a session', async () => {
    const status = await invoke(IPC_CHANNELS.setupGetStatus)
    expect(status).toMatchObject({ ok: true, data: { isSetupComplete: true } })
    const session = await invoke(IPC_CHANNELS.authGetSession)
    expect(session).toMatchObject({ ok: true, data: { session: null } })
  })

  it('rejects a protected call with no session, even before validating its input', async () => {
    expect(errorCode(await invoke(IPC_CHANNELS.usersList))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.usersCreate, { garbage: true }))).toBe(
      'UNAUTHENTICATED'
    )
    expect(errorCode(await invoke(IPC_CHANNELS.auditList, {}))).toBe('UNAUTHENTICATED')
  })

  it('rejects calls from an untrusted sender', async () => {
    trusted = false
    expect(errorCode(await invoke(IPC_CHANNELS.authLogin, {}))).toBe('FORBIDDEN_SENDER')
  })

  it('signs in over IPC and serves what the owner may see', async () => {
    const login = await invoke(IPC_CHANNELS.authLogin, {
      username: 'Owner',
      password: OWNER_PASSWORD
    })
    expect(login.ok).toBe(true)
    const staff = await invoke(IPC_CHANNELS.usersList)
    expect(staff).toMatchObject({ ok: true })
    const audit = await invoke(IPC_CHANNELS.auditList, {})
    expect(audit).toMatchObject({ ok: true, data: { page: 1, pageSize: 25 } })
  })

  it('refuses a wrong password with a friendly code', async () => {
    const login = await invoke(IPC_CHANNELS.authLogin, {
      username: 'owner',
      password: 'wrong-password-1'
    })
    expect(errorCode(login)).toBe('INVALID_CREDENTIALS')
  })

  it('validates input for signed-in callers', async () => {
    await loginAsOwner(app)
    expect(errorCode(await invoke(IPC_CHANNELS.usersCreate, { username: 'x' }))).toBe(
      'VALIDATION_ERROR'
    )
  })

  it('denies a signed-in user who lacks the permission, and allows what they do hold', async () => {
    await loginAsOwner(app)
    const owner = app.services.auth.authorize([])
    const role = app.services.roles.create(
      owner,
      createRoleInputSchema.parse({ name: 'Cashier', permissions: ['pos.access'] })
    )
    await app.services.users.create(
      owner,
      createStaffInputSchema.parse({
        username: 'cashier1',
        password: 'Biryani-2026',
        fullName: 'Cass Hier',
        roleIds: [role.id]
      })
    )
    app.services.auth.logout()

    const login = await invoke(IPC_CHANNELS.authLogin, {
      username: 'cashier1',
      password: 'Biryani-2026'
    })
    expect(login).toMatchObject({ ok: true, data: { user: { mustChangePassword: true } } })

    // While a password change is pending nothing else works...
    expect(errorCode(await invoke(IPC_CHANNELS.restaurantGet))).toBe('PASSWORD_CHANGE_REQUIRED')

    const change = await invoke(IPC_CHANNELS.authChangePassword, {
      currentPassword: 'Biryani-2026',
      newPassword: 'Fresh-Password-9',
      confirmPassword: 'Fresh-Password-9'
    })
    expect(change.ok).toBe(true)

    // ...afterwards only what the role grants.
    expect(errorCode(await invoke(IPC_CHANNELS.usersList))).toBe('FORBIDDEN')
    expect(errorCode(await invoke(IPC_CHANNELS.rolesDelete, { id: role.id }))).toBe('FORBIDDEN')
    expect(errorCode(await invoke(IPC_CHANNELS.auditList, {}))).toBe('FORBIDDEN')
    expect((await invoke(IPC_CHANNELS.authTouch)).ok).toBe(true)
  })

  it('lets a waiter work the floor over IPC but not change the setup', async () => {
    await loginAsOwner(app)
    const owner = app.services.auth.authorize([])
    const area = app.services.areas.create(owner, {
      name: 'Hall',
      floor: null,
      description: null,
      sortOrder: 0
    })
    const table = app.services.tables.create(
      owner,
      createTableInputSchema.parse({ areaId: area.id, tableNumber: 'T1', capacity: 4, type: 'AC' })
    )
    const role = app.services.roles.create(
      owner,
      createRoleInputSchema.parse({ name: 'Waiter', permissions: ['pos.access', 'tables.operate'] })
    )
    await app.services.users.create(
      owner,
      createStaffInputSchema.parse({
        username: 'waiter1',
        password: 'Biryani-2026',
        fullName: 'Wally Waiter',
        roleIds: [role.id]
      })
    )
    app.services.auth.logout()
    await invoke(IPC_CHANNELS.authLogin, { username: 'waiter1', password: 'Biryani-2026' })
    await invoke(IPC_CHANNELS.authChangePassword, {
      currentPassword: 'Biryani-2026',
      newPassword: 'Fresh-Password-9',
      confirmPassword: 'Fresh-Password-9'
    })

    expect((await invoke(IPC_CHANNELS.tablesFloor)).ok).toBe(true)
    expect(errorCode(await invoke(IPC_CHANNELS.tablesCreate, { garbage: true }))).toBe('FORBIDDEN')
    expect(errorCode(await invoke(IPC_CHANNELS.areasDelete, { id: area.id }))).toBe('FORBIDDEN')
    expect(
      errorCode(await invoke(IPC_CHANNELS.tablesSaveLayout, { areaId: area.id, positions: [] }))
    ).toBe('FORBIDDEN')
    const opened = await invoke(IPC_CHANNELS.tablesOpen, { id: table.id, guestCount: 2 })
    expect(opened).toMatchObject({ ok: true, data: { status: 'OCCUPIED', guestCount: 2 } })
    expect(errorCode(await invoke(IPC_CHANNELS.tablesOpen, { id: table.id }))).toBe('CONFLICT')
    expect(errorCode(await invoke(IPC_CHANNELS.tablesOpen, { id: 'not-a-uuid' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect((await invoke(IPC_CHANNELS.tablesClose, { id: table.id })).ok).toBe(true)
  })

  it('expires the session over IPC and tells the screen why', async () => {
    await invoke(IPC_CHANNELS.authLogin, { username: 'owner', password: OWNER_PASSWORD })
    app.clock.advance(31 * 60_000)
    expect(errorCode(await invoke(IPC_CHANNELS.usersList))).toBe('SESSION_EXPIRED')
    expect(errorCode(await invoke(IPC_CHANNELS.usersList))).toBe('UNAUTHENTICATED')
  })

  it('signs out over IPC', async () => {
    await invoke(IPC_CHANNELS.authLogin, { username: 'owner', password: OWNER_PASSWORD })
    expect((await invoke(IPC_CHANNELS.authLogout)).ok).toBe(true)
    expect(errorCode(await invoke(IPC_CHANNELS.usersList))).toBe('UNAUTHENTICATED')
  })
})
