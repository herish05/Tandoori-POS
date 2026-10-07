import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { PermissionCode } from '@shared/permissions'
import type { Reservation } from '@shared/reservations'
import type { CustomerDetail, CustomerLookupResult } from '@shared/customers'
import type { IpcResult } from '@shared/types'
import { registerAuthHandlers } from '@main/auth-handlers'
import { registerCustomerHandlers } from '@main/customer-handlers'
import { registerReservationHandlers } from '@main/reservation-handlers'
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

describe('customer and reservation IPC', () => {
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

  const soon = () => new Date(app.clock.now + 3 * 60 * 60_000).toISOString()

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
    registerCustomerHandlers(registrar, app.services)
    registerReservationHandlers(registrar, app.services)
    await loginAsOwner(app)
  })
  afterEach(() => {
    app.cleanup()
  })

  it('needs a session', async () => {
    app.services.auth.logout()
    expect(errorCode(await invoke(IPC_CHANNELS.customersList, {}))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.reservationsList, {}))).toBe('UNAUTHENTICATED')
  })

  it('lets the owner keep customers and bookings over IPC', async () => {
    const customer = await invoke<CustomerDetail>(IPC_CHANNELS.customersCreate, {
      name: 'Gurpreet',
      phone: '98765 43210'
    })
    expect(customer).toMatchObject({ ok: true, data: { phone: '9876543210' } })
    expect(await invoke(IPC_CHANNELS.customersList, { search: 'gurp' })).toMatchObject({
      ok: true,
      data: [{ name: 'Gurpreet' }]
    })
    expect(
      await invoke<CustomerLookupResult[]>(IPC_CHANNELS.customersLookup, { query: '98765' })
    ).toMatchObject({ ok: true, data: [{ name: 'Gurpreet' }] })

    const booked = await invoke<Reservation>(IPC_CHANNELS.reservationsCreate, {
      guestName: 'Gurpreet',
      guestPhone: '98765 43210',
      partySize: 3,
      reservedFor: soon()
    })
    expect(booked).toMatchObject({ ok: true, data: { status: 'BOOKED' } })
    const id = booked.ok ? booked.data.id : ''
    expect(
      await invoke(IPC_CHANNELS.reservationsCancel, { id, reason: 'Plans changed' })
    ).toMatchObject({ ok: true, data: { status: 'CANCELLED' } })
  })

  it('validates input', async () => {
    expect(errorCode(await invoke(IPC_CHANNELS.customersCreate, { name: '', phone: '1' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(errorCode(await invoke(IPC_CHANNELS.customersLookup, { query: 'a' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(errorCode(await invoke(IPC_CHANNELS.reservationsGet, { id: 'nope' }))).toBe(
      'VALIDATION_ERROR'
    )
  })

  it('lets view-only staff read but not change customers or bookings', async () => {
    await signInWith('viewer', ['customers.view', 'reservations.view'])
    expect(await invoke(IPC_CHANNELS.customersList, {})).toMatchObject({ ok: true })
    expect(await invoke(IPC_CHANNELS.reservationsList, {})).toMatchObject({ ok: true })
    expect(
      errorCode(await invoke(IPC_CHANNELS.customersCreate, { name: 'A', phone: '9876543210' }))
    ).toBe('FORBIDDEN')
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.reservationsCreate, {
          guestName: 'A',
          guestPhone: '9876543210',
          partySize: 2,
          reservedFor: soon()
        })
      )
    ).toBe('FORBIDDEN')
    // Looking customers up for an order is for those who take orders.
    expect(errorCode(await invoke(IPC_CHANNELS.customersLookup, { query: 'ab' }))).toBe('FORBIDDEN')
  })

  it('lets staff who take orders look customers up', async () => {
    await signInWith('waiter', ['orders.view', 'orders.operate'])
    expect(await invoke(IPC_CHANNELS.customersLookup, { query: 'ab' })).toMatchObject({ ok: true })
    expect(errorCode(await invoke(IPC_CHANNELS.customersList, {}))).toBe('FORBIDDEN')
  })

  it('needs table permission as well to seat a booking', async () => {
    const owner = app.services.auth.authorize([])
    const booked = app.services.reservations.create(owner, {
      guestName: 'Harpreet',
      guestPhone: '9876543210',
      partySize: 2,
      reservedFor: soon(),
      durationMinutes: 90,
      tableId: null,
      notes: null
    })
    await signInWith('host', ['reservations.view', 'reservations.operate'])
    expect(errorCode(await invoke(IPC_CHANNELS.reservationsSeat, { id: booked.id }))).toBe(
      'FORBIDDEN'
    )
    expect(await invoke(IPC_CHANNELS.reservationsNoShow, { id: booked.id })).toMatchObject({
      ok: false
    })
  })
})
