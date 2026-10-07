import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  KotDetail,
  KotPreview,
  KotPrintOutcome,
  KotSummary,
  PrinterConfig,
  PrinterTestOutcome,
  SendOrderResult
} from '@shared/kitchen'
import { createCategoryInputSchema, createItemInputSchema } from '@shared/menu'
import type { OrderDetail } from '@shared/orders'
import type { PermissionCode } from '@shared/permissions'
import type { IpcResult } from '@shared/types'
import { registerAuthHandlers } from '@main/auth-handlers'
import { registerKitchenHandlers } from '@main/kitchen-handlers'
import { registerOrderHandlers } from '@main/order-handlers'
import { createIpcRegistrar } from '@main/ipc/registrar'
import { PrintError, type PrinterDriver } from '@main/printing/drivers'
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

/** The data of a call that must have succeeded. */
function data<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(`call failed: ${result.error.code} ${result.error.message}`)
  return result.data
}

const PASSWORD = 'Biryani-2026'

describe('kitchen and printer IPC', () => {
  let app: TestApp
  let itemId: string
  let printerMode: 'ok' | 'fail' = 'ok'
  const printed: string[] = []
  const driver: PrinterDriver = {
    print(_target, payload) {
      if (printerMode === 'fail') return Promise.reject(new PrintError('The printer is offline.'))
      printed.push(payload.lines.join('\n'))
      return Promise.resolve()
    },
    listDevices: () => Promise.resolve(['USB Receipt'])
  }

  const signInWith = async (username: string, permissions: PermissionCode[]) => {
    app.services.auth.logout()
    await loginAsOwner(app)
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

  const addPrinter = (extra: Record<string, unknown> = {}) =>
    invoke<PrinterConfig>(IPC_CHANNELS.printersCreate, {
      name: 'Kitchen printer',
      kind: 'NETWORK',
      address: '192.168.1.60',
      paperWidth: 80,
      isDefault: true,
      ...extra
    })
  const takeaway = async () =>
    data(
      await invoke<OrderDetail>(IPC_CHANNELS.ordersCreate, {
        type: 'TAKEAWAY',
        lines: [{ menuItemId: itemId, quantity: 2 }]
      })
    )

  beforeEach(async () => {
    electron.handlers.clear()
    printerMode = 'ok'
    printed.length = 0
    app = createTestApp(undefined, { NETWORK: driver, SYSTEM: driver })
    await completeSetup(app)
    const registrar = createIpcRegistrar({
      logger: silentLogger,
      securityLogger: silentLogger,
      isTrustedSender: () => true,
      authorize: (required, options) => app.services.auth.authorize(required, options)
    })
    registerAuthHandlers(registrar, app.services)
    registerOrderHandlers(registrar, app.services)
    registerKitchenHandlers(registrar, app.services)

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

  it('needs a session for everything', async () => {
    app.services.auth.logout()
    for (const channel of [
      IPC_CHANNELS.kotsList,
      IPC_CHANNELS.printersList,
      IPC_CHANNELS.printersSystemDevices
    ]) {
      expect(errorCode(await invoke(channel, {}))).toBe('UNAUTHENTICATED')
    }
  })

  it('sends an order, issues the ticket and prints it', async () => {
    data(await addPrinter())
    const order = await takeaway()
    const result = data(await invoke<SendOrderResult>(IPC_CHANNELS.ordersSend, { id: order.id }))
    expect(result.order.status).toBe('CONFIRMED')
    expect(result.kots).toHaveLength(1)
    expect(result.print).toEqual([
      expect.objectContaining({ status: 'PRINTED', printerName: 'Kitchen printer', error: null })
    ])
    expect(printed[0]).toContain('Dal')
    expect(printed[0]).toContain('TK-KOT-000001')
  })

  it('still sends the order when the printer is down, and says so', async () => {
    data(await addPrinter())
    printerMode = 'fail'
    const order = await takeaway()
    const result = data(await invoke<SendOrderResult>(IPC_CHANNELS.ordersSend, { id: order.id }))
    expect(result.order.status).toBe('CONFIRMED')
    expect(result.print[0]).toMatchObject({ status: 'FAILED', error: 'The printer is offline.' })
    expect(result.kots[0]?.id).toBeTruthy()

    const [ticket] = data(await invoke<KotSummary[]>(IPC_CHANNELS.kotsList, { openOnly: true }))
    expect(ticket).toMatchObject({
      printStatus: 'FAILED',
      lastPrintError: 'The printer is offline.'
    })

    // Staff fix the printer and reprint; the ticket records it.
    printerMode = 'ok'
    const again = data(await invoke<KotPrintOutcome>(IPC_CHANNELS.kotsPrint, { id: ticket?.id }))
    expect(again.status).toBe('PRINTED')
    expect(printed[0]).toContain('(REPRINT)')
  })

  it('lists, shows and previews tickets, and the kitchen moves them along', async () => {
    const order = await takeaway()
    data(await invoke<SendOrderResult>(IPC_CHANNELS.ordersSend, { id: order.id }))
    const [ticket] = data(await invoke<KotSummary[]>(IPC_CHANNELS.kotsList, { orderId: order.id }))
    const id = ticket?.id
    expect(data(await invoke<KotDetail>(IPC_CHANNELS.kotsGet, { id })).items).toHaveLength(1)
    const preview = data(await invoke<KotPreview>(IPC_CHANNELS.kotsPreview, { id, paperWidth: 58 }))
    expect(preview.columns).toBe(32)
    expect(preview.lines.join('\n')).toContain('Dal')

    expect(
      data(await invoke<KotDetail>(IPC_CHANNELS.kotsSetStatus, { id, status: 'ACCEPTED' })).status
    ).toBe('ACCEPTED')
    expect(errorCode(await invoke(IPC_CHANNELS.kotsSetStatus, { id, status: 'SERVED' }))).toBe(
      'CONFLICT'
    )
    expect(errorCode(await invoke(IPC_CHANNELS.kotsSetStatus, { id, status: 'CANCELLED' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(errorCode(await invoke(IPC_CHANNELS.kotsGet, { id: 'nope' }))).toBe('VALIDATION_ERROR')
    const cancelled = data(
      await invoke<KotDetail>(IPC_CHANNELS.kotsCancel, { id, reason: 'Customer left' })
    )
    expect(cancelled.status).toBe('CANCELLED')
  })

  it('manages printers over IPC and validates them', async () => {
    expect(errorCode(await addPrinter({ address: 'bad address' }))).toBe('VALIDATION_ERROR')
    const printer = data(await addPrinter())
    expect(errorCode(await addPrinter({ name: 'kitchen PRINTER' }))).toBe('CONFLICT')
    expect(data(await invoke<PrinterConfig[]>(IPC_CHANNELS.printersList))).toHaveLength(1)
    const updated = data(
      await invoke<PrinterConfig>(IPC_CHANNELS.printersUpdate, {
        id: printer.id,
        name: 'Kitchen printer',
        kind: 'NETWORK',
        address: '192.168.1.61',
        paperWidth: 58,
        isDefault: true
      })
    )
    expect(updated).toMatchObject({ address: '192.168.1.61', paperWidth: 58 })
    expect(
      data(await invoke<PrinterTestOutcome>(IPC_CHANNELS.printersTest, { id: printer.id }))
    ).toEqual({ status: 'PRINTED', error: null })
    expect(data(await invoke<string[]>(IPC_CHANNELS.printersSystemDevices))).toEqual([
      'USB Receipt'
    ])
    data(await invoke(IPC_CHANNELS.printersDelete, { id: printer.id }))
    expect(data(await invoke<PrinterConfig[]>(IPC_CHANNELS.printersList))).toEqual([])
  })

  describe('permissions', () => {
    const makeTicket = async () => {
      const order = await takeaway()
      const sent = data(await invoke<SendOrderResult>(IPC_CHANNELS.ordersSend, { id: order.id }))
      return sent.kots[0]?.id ?? ''
    }

    it('lets kitchen staff see and move tickets but not order, cancel or manage printers', async () => {
      const id = await makeTicket()
      await signInWith('cook', ['kitchen.operate'])
      expect(
        data(await invoke<KotSummary[]>(IPC_CHANNELS.kotsList, { openOnly: true }))
      ).toHaveLength(1)
      expect(
        data(await invoke<KotDetail>(IPC_CHANNELS.kotsSetStatus, { id, status: 'ACCEPTED' })).status
      ).toBe('ACCEPTED')
      expect(data(await invoke<KotPrintOutcome>(IPC_CHANNELS.kotsPrint, { id })).status).toBe(
        'FAILED'
      )
      expect(errorCode(await invoke(IPC_CHANNELS.kotsCancel, { id, reason: 'Out of stock' }))).toBe(
        'FORBIDDEN'
      )
      expect(errorCode(await invoke(IPC_CHANNELS.ordersCatalog))).toBe('FORBIDDEN')
      expect(errorCode(await invoke(IPC_CHANNELS.printersList))).toBe('FORBIDDEN')
      expect(errorCode(await addPrinter())).toBe('FORBIDDEN')
    })

    it('lets a view-only user read tickets but not change or print them', async () => {
      const id = await makeTicket()
      await signInWith('viewer', ['orders.view'])
      expect(data(await invoke<KotSummary[]>(IPC_CHANNELS.kotsList, {}))).toHaveLength(1)
      expect(data(await invoke<KotPreview>(IPC_CHANNELS.kotsPreview, { id })).kotId).toBe(id)
      expect(errorCode(await invoke(IPC_CHANNELS.kotsSetStatus, { id, status: 'ACCEPTED' }))).toBe(
        'FORBIDDEN'
      )
      expect(errorCode(await invoke(IPC_CHANNELS.kotsPrint, { id }))).toBe('FORBIDDEN')
    })

    it('keeps tickets from anyone without order or kitchen access', async () => {
      await makeTicket()
      await signInWith('stranger', ['printers.view'])
      expect(errorCode(await invoke(IPC_CHANNELS.kotsList, {}))).toBe('FORBIDDEN')
      expect(errorCode(await invoke(IPC_CHANNELS.kotsGet, { id: crypto.randomUUID() }))).toBe(
        'FORBIDDEN'
      )
      expect(data(await invoke<PrinterConfig[]>(IPC_CHANNELS.printersList))).toEqual([])
      expect(errorCode(await addPrinter())).toBe('FORBIDDEN')
    })

    it('lets a waiter reprint tickets, and a manager cancel them', async () => {
      const id = await makeTicket()
      data(await addPrinter())
      await signInWith('waiter', ['orders.operate'])
      expect(data(await invoke<KotPrintOutcome>(IPC_CHANNELS.kotsPrint, { id })).status).toBe(
        'PRINTED'
      )
      await signInWith('manager', ['orders.cancel'])
      expect(
        data(await invoke<KotDetail>(IPC_CHANNELS.kotsCancel, { id, reason: 'Wrong table' })).status
      ).toBe('CANCELLED')
    })

    it('lets printer managers set printers up', async () => {
      await signInWith('admin', ['printers.manage'])
      expect(data(await invoke<PrinterConfig[]>(IPC_CHANNELS.printersList))).toEqual([])
      expect(data(await addPrinter()).name).toBe('Kitchen printer')
    })
  })
})
