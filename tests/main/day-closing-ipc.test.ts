import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import type { DayClosing, DayOverview, DayStatus } from '@shared/day-closing'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { PermissionCode } from '@shared/permissions'
import type { IpcResult } from '@shared/types'
import { registerAuthHandlers } from '@main/auth-handlers'
import { registerFinanceHandlers } from '@main/finance-handlers'
import { createIpcRegistrar } from '@main/ipc/registrar'
import { completeSetup, createTestApp, loginAsOwner, silentLogger, type TestApp } from './helpers'

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

async function invoke<T = unknown>(channel: string, raw?: unknown) {
  const handler = electron.handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return (await handler(trustedEvent, raw)) as IpcResult<T>
}

const errorCode = (result: IpcResult<unknown>): string | null =>
  result.ok ? null : result.error.code

const PASSWORD = 'Biryani-2026'

describe('day closing IPC', () => {
  let app: TestApp

  const signInWith = async (username: string, permissions: PermissionCode[]) => {
    const owner = app.services.auth.authorize([])
    const role = app.services.roles.create(
      owner,
      createRoleInputSchema.parse({ name: `Role ${username}`, permissions })
    )
    await app.services.users.create(
      owner,
      createStaffInputSchema.parse({
        username,
        password: PASSWORD,
        fullName: `Staff ${username}`,
        roleIds: [role.id]
      })
    )
    app.services.auth.logout()
    await invoke(IPC_CHANNELS.authLogin, { username, password: PASSWORD })
    await invoke(IPC_CHANNELS.authChangePassword, {
      currentPassword: PASSWORD,
      newPassword: 'Fresh-Password-9',
      confirmPassword: 'Fresh-Password-9'
    })
  }

  beforeEach(async () => {
    electron.handlers.clear()
    app = createTestApp()
    await completeSetup(app)
    const registrar = createIpcRegistrar({
      logger: silentLogger,
      securityLogger: silentLogger,
      isTrustedSender: () => true,
      authorize: (required, options) => app.services.auth.authorize(required, options)
    })
    registerAuthHandlers(registrar, app.services)
    registerFinanceHandlers(registrar, app.services)
    await loginAsOwner(app)
  })
  afterEach(() => {
    app.cleanup()
  })

  it('needs a session', async () => {
    app.services.auth.logout()
    expect(errorCode(await invoke(IPC_CHANNELS.dayOverview))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.dayStatus, {}))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.dayList, {}))).toBe('UNAUTHENTICATED')
    expect(
      errorCode(await invoke(IPC_CHANNELS.dayClose, { date: '2026-01-05', countedCash: 0 }))
    ).toBe('UNAUTHENTICATED')
  })

  it('lets the owner close and reopen a day end to end', async () => {
    const overview = await invoke<DayOverview>(IPC_CHANNELS.dayOverview)
    expect(overview).toMatchObject({ ok: true, data: { todayClosed: false } })
    const date = overview.ok ? overview.data.today : ''

    expect(await invoke<DayStatus>(IPC_CHANNELS.dayStatus, { date })).toMatchObject({
      ok: true,
      data: { date, canClose: true, closing: null }
    })

    const closed = await invoke<DayClosing>(IPC_CHANNELS.dayClose, {
      date,
      countedCash: 0,
      denominations: []
    })
    expect(closed).toMatchObject({
      ok: true,
      data: { closingNumber: 'TK-DAY-000001', variance: 0, closedBy: 'Olivia Owner' }
    })
    const id = closed.ok ? closed.data.id : ''
    expect(await invoke(IPC_CHANNELS.dayGet, { id })).toMatchObject({ ok: true, data: { id } })
    expect(await invoke(IPC_CHANNELS.dayList, {})).toMatchObject({ ok: true, data: [{ id }] })
    expect(await invoke(IPC_CHANNELS.dayOverview)).toMatchObject({
      ok: true,
      data: { todayClosed: true }
    })
    expect(errorCode(await invoke(IPC_CHANNELS.dayClose, { date, countedCash: 0 }))).toBe(
      'CONFLICT'
    )

    expect(await invoke(IPC_CHANNELS.dayReopen, { id, reason: 'Missed a bill' })).toMatchObject({
      ok: true,
      data: { reopenReason: 'Missed a bill' }
    })
    expect(errorCode(await invoke(IPC_CHANNELS.dayReopen, { id, reason: 'Again' }))).toBe(
      'CONFLICT'
    )
  })

  it('refuses malformed input before touching the data', async () => {
    expect(errorCode(await invoke(IPC_CHANNELS.dayClose, { date: 'today', countedCash: 0 }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(
      errorCode(await invoke(IPC_CHANNELS.dayClose, { date: '2026-01-05', countedCash: -5 }))
    ).toBe('VALIDATION_ERROR')
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.dayClose, {
          date: '2026-01-05',
          countedCash: 1000,
          denominations: [{ value: 50000, count: 1 }]
        })
      )
    ).toBe('VALIDATION_ERROR')
    expect(errorCode(await invoke(IPC_CHANNELS.dayReopen, { id: 'nope', reason: 'x' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(errorCode(await invoke(IPC_CHANNELS.dayGet, { id: 'nope' }))).toBe('VALIDATION_ERROR')
    expect(errorCode(await invoke(IPC_CHANNELS.dayStatus, { date: '5 Jan' }))).toBe(
      'VALIDATION_ERROR'
    )
  })

  describe('permissions', () => {
    const closeOne = () => {
      const owner = app.services.auth.authorize([])
      return app.services.dayClosing.close(owner, {
        date: app.services.dayClosing.overview().today,
        countedCash: 0,
        notes: null
      })
    }

    it('lets a viewer read but not close or reopen', async () => {
      const closing = closeOne()
      await signInWith('viewer', ['day.view'])
      expect(errorCode(await invoke(IPC_CHANNELS.dayOverview))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.dayStatus, {}))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.dayList, {}))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.dayGet, { id: closing.id }))).toBeNull()
      expect(
        errorCode(await invoke(IPC_CHANNELS.dayClose, { date: '2026-01-04', countedCash: 0 }))
      ).toBe('FORBIDDEN')
      expect(errorCode(await invoke(IPC_CHANNELS.dayReopen, { id: closing.id, reason: 'x' }))).toBe(
        'FORBIDDEN'
      )
    })

    it('lets someone with day.close also read, but not reopen', async () => {
      const closing = closeOne()
      await signInWith('closer', ['day.close'])
      expect(errorCode(await invoke(IPC_CHANNELS.dayOverview))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.dayGet, { id: closing.id }))).toBeNull()
      expect(errorCode(await invoke(IPC_CHANNELS.dayReopen, { id: closing.id, reason: 'x' }))).toBe(
        'FORBIDDEN'
      )
    })

    it('lets someone with day.reopen reopen but not close', async () => {
      const closing = closeOne()
      await signInWith('manager', ['day.reopen'])
      expect(errorCode(await invoke(IPC_CHANNELS.dayList, {}))).toBeNull()
      expect(
        errorCode(await invoke(IPC_CHANNELS.dayClose, { date: '2026-01-04', countedCash: 0 }))
      ).toBe('FORBIDDEN')
      expect(
        errorCode(await invoke(IPC_CHANNELS.dayReopen, { id: closing.id, reason: 'Fix' }))
      ).toBeNull()
    })

    it('gives nothing to someone without any day permission', async () => {
      await signInWith('waiter', ['orders.view'])
      expect(errorCode(await invoke(IPC_CHANNELS.dayOverview))).toBe('FORBIDDEN')
      expect(errorCode(await invoke(IPC_CHANNELS.dayList, {}))).toBe('FORBIDDEN')
    })
  })
})
