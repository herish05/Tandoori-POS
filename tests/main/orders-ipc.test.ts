import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { createCategoryInputSchema, createItemInputSchema } from '@shared/menu'
import type { OrderDetail } from '@shared/orders'
import type { PermissionCode } from '@shared/permissions'
import type { IpcResult } from '@shared/types'
import { registerAuthHandlers } from '@main/auth-handlers'
import { registerOrderHandlers } from '@main/order-handlers'
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

describe('order IPC', () => {
  let app: TestApp
  let itemId: string

  /** Creates a staff account with the given permissions and signs it in. */
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
    registerOrderHandlers(registrar, app.services)

    await loginAsOwner(app)
    const owner = app.services.auth.authorize([])
    const category = app.services.categories.create(
      owner,
      createCategoryInputSchema.parse({ name: 'Mains' })
    )
    itemId = app.services.items.create(
      owner,
      createItemInputSchema.parse({
        categoryId: category.id,
        name: 'Dal',
        price: 20000,
        foodType: 'VEG'
      })
    ).id
  })
  afterEach(() => {
    app.cleanup()
  })

  const takeaway = { type: 'TAKEAWAY', lines: [{ menuItemId: '', quantity: 1 }] }

  it('needs a session', async () => {
    app.services.auth.logout()
    expect(errorCode(await invoke(IPC_CHANNELS.ordersList, {}))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.ordersCreate, { nonsense: true }))).toBe(
      'UNAUTHENTICATED'
    )
  })

  it('lets the owner take, send and cancel an order over IPC', async () => {
    const created = await invoke<OrderDetail>(IPC_CHANNELS.ordersCreate, {
      ...takeaway,
      lines: [{ menuItemId: itemId, quantity: 2 }]
    })
    expect(created).toMatchObject({
      ok: true,
      data: { orderNumber: 'TK-ORD-000001', subtotal: 40000, status: 'DRAFT' }
    })
    const id = created.ok ? created.data.id : ''
    expect(await invoke(IPC_CHANNELS.ordersGet, { id })).toMatchObject({ ok: true })
    // No printer is set up, so the ticket does not print, but the order is still sent.
    expect(await invoke(IPC_CHANNELS.ordersSend, { id })).toMatchObject({
      ok: true,
      data: {
        order: { status: 'CONFIRMED' },
        kots: [{ kotNumber: 'TK-KOT-000001' }],
        print: [{ status: 'FAILED' }]
      }
    })
    expect(await invoke(IPC_CHANNELS.ordersList, { activeOnly: true })).toMatchObject({
      ok: true,
      data: [{ id }]
    })
    expect(await invoke(IPC_CHANNELS.ordersCancel, { id, reason: 'Customer left' })).toMatchObject({
      ok: true,
      data: { status: 'CANCELLED' }
    })
    expect(await invoke(IPC_CHANNELS.ordersCatalog)).toMatchObject({ ok: true })
  })

  it('validates input and never trusts client prices', async () => {
    expect(
      errorCode(await invoke(IPC_CHANNELS.ordersCreate, { type: 'TAKEAWAY', lines: [] }))
    ).toBe('VALIDATION_ERROR')
    expect(errorCode(await invoke(IPC_CHANNELS.ordersGet, { id: 'nope' }))).toBe('VALIDATION_ERROR')
    const created = await invoke<OrderDetail>(IPC_CHANNELS.ordersCreate, {
      type: 'TAKEAWAY',
      lines: [{ menuItemId: itemId, quantity: 1, price: 1, unitPrice: 1 }]
    })
    expect(created).toMatchObject({ ok: true, data: { subtotal: 20000 } })
  })

  it('lets a view-only user read but not change orders', async () => {
    await invoke(IPC_CHANNELS.ordersCreate, {
      type: 'TAKEAWAY',
      lines: [{ menuItemId: itemId, quantity: 1 }]
    })
    await signInWith('viewer', ['orders.view'])
    expect(await invoke(IPC_CHANNELS.ordersList, {})).toMatchObject({ ok: true })
    expect(errorCode(await invoke(IPC_CHANNELS.ordersCatalog))).toBe('FORBIDDEN')
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.ordersCreate, {
          type: 'TAKEAWAY',
          lines: [{ menuItemId: itemId, quantity: 1 }]
        })
      )
    ).toBe('FORBIDDEN')
  })

  it('lets a waiter take orders but not cancel sent items or orders', async () => {
    await signInWith('waiter', ['orders.view', 'orders.operate'])
    const created = await invoke<OrderDetail>(IPC_CHANNELS.ordersCreate, {
      type: 'TAKEAWAY',
      lines: [{ menuItemId: itemId, quantity: 1 }]
    })
    expect(created.ok).toBe(true)
    const order = (created as { ok: true; data: OrderDetail }).data
    const sent = await invoke(IPC_CHANNELS.ordersSend, { id: order.id })
    expect(sent.ok).toBe(true)
    const lineId = order.lines[0]?.id

    expect(
      errorCode(
        await invoke(IPC_CHANNELS.ordersCancelLine, {
          orderId: order.id,
          lineId,
          reason: 'Customer changed mind'
        })
      )
    ).toBe('FORBIDDEN')
    expect(
      errorCode(await invoke(IPC_CHANNELS.ordersCancel, { id: order.id, reason: 'Customer left' }))
    ).toBe('FORBIDDEN')
  })

  it('lets a manager with the cancel permission cancel', async () => {
    await signInWith('manager', ['orders.cancel'])
    const created = await invoke<OrderDetail>(IPC_CHANNELS.ordersCreate, {
      type: 'TAKEAWAY',
      lines: [{ menuItemId: itemId, quantity: 1 }]
    })
    const order = (created as { ok: true; data: OrderDetail }).data
    await invoke(IPC_CHANNELS.ordersSend, { id: order.id })
    expect(
      await invoke(IPC_CHANNELS.ordersCancelLine, {
        orderId: order.id,
        lineId: order.lines[0]?.id,
        reason: 'Customer changed mind'
      })
    ).toMatchObject({ ok: true })
    expect(
      await invoke(IPC_CHANNELS.ordersCancel, { id: order.id, reason: 'Customer left' })
    ).toMatchObject({ ok: true, data: { status: 'CANCELLED' } })
  })
})
