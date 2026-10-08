import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { Purchase, PurchasingSummary, Supplier } from '@shared/purchasing'
import type { PermissionCode } from '@shared/permissions'
import type { IpcResult } from '@shared/types'
import { registerAuthHandlers } from '@main/auth-handlers'
import { registerPurchasingHandlers } from '@main/purchasing-handlers'
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

describe('purchasing IPC', () => {
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

  /** A supplier, a stock item and a draft purchase, made as the owner. */
  const seed = async () => {
    const dairy = await invoke<Supplier>(IPC_CHANNELS.suppliersCreate, { name: 'Sharma Dairy' })
    const paneer = app.services.inventory.create(app.services.auth.authorize([]), {
      name: 'Paneer',
      unit: 'KG',
      reorderLevel: 0,
      unitCost: 0,
      openingStock: 0,
      category: null
    })
    return { supplierId: dairy.ok ? dairy.data.id : '', item: paneer }
  }
  const draftInput = (supplierId: string, itemId: string) => ({
    supplierId,
    purchaseDate: '2026-01-05',
    lines: [{ inventoryItemId: itemId, quantity: 2000, unitCost: 30000 }]
  })

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
    registerPurchasingHandlers(registrar, app.services)
    await loginAsOwner(app)
  })
  afterEach(() => {
    app.cleanup()
  })

  it('needs a session', async () => {
    app.services.auth.logout()
    expect(errorCode(await invoke(IPC_CHANNELS.suppliersList, {}))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.purchasesSummary))).toBe('UNAUTHENTICATED')
    expect(errorCode(await invoke(IPC_CHANNELS.purchasesList, {}))).toBe('UNAUTHENTICATED')
  })

  it('lets the owner run a purchase from draft to paid', async () => {
    const { supplierId, item } = await seed()
    const created = await invoke<Purchase>(
      IPC_CHANNELS.purchasesCreate,
      draftInput(supplierId, item.id)
    )
    expect(created).toMatchObject({ ok: true, data: { status: 'DRAFT', total: 60000 } })
    const id = created.ok ? created.data.id : ''
    expect(await invoke(IPC_CHANNELS.purchasesReceive, { id })).toMatchObject({
      ok: true,
      data: { status: 'RECEIVED', paymentStatus: 'UNPAID' }
    })
    expect(app.services.inventory.get(item.id).onHand).toBe(2000)
    const part = await invoke<Purchase>(IPC_CHANNELS.purchasesRecordPayment, {
      purchaseId: id,
      amount: 25000,
      method: 'UPI'
    })
    expect(part).toMatchObject({ ok: true, data: { paymentStatus: 'PARTIAL', amountDue: 35000 } })
    const paymentId = part.ok ? (part.data.payments[0]?.id ?? '') : ''
    expect(
      await invoke(IPC_CHANNELS.purchasesVoidPayment, { id: paymentId, reason: 'Mistake' })
    ).toMatchObject({ ok: true, data: { paymentStatus: 'UNPAID' } })
    expect(await invoke<PurchasingSummary>(IPC_CHANNELS.purchasesSummary)).toMatchObject({
      ok: true,
      data: { totalDue: 60000, unpaidCount: 1 }
    })
    expect(await invoke(IPC_CHANNELS.suppliersGet, { id: supplierId })).toMatchObject({
      ok: true,
      data: { amountDue: 60000 }
    })
  })

  it('validates input', async () => {
    const { supplierId, item } = await seed()
    expect(errorCode(await invoke(IPC_CHANNELS.suppliersCreate, { name: '' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.purchasesCreate, {
          ...draftInput(supplierId, item.id),
          lines: []
        })
      )
    ).toBe('VALIDATION_ERROR')
    expect(errorCode(await invoke(IPC_CHANNELS.purchasesGet, { id: 'nope' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.purchasesRecordPayment, {
          purchaseId: supplierId,
          amount: -5,
          method: 'CASH'
        })
      )
    ).toBe('VALIDATION_ERROR')
  })

  it('lets view-only staff read but not change anything', async () => {
    const { supplierId, item } = await seed()
    const created = await invoke<Purchase>(
      IPC_CHANNELS.purchasesCreate,
      draftInput(supplierId, item.id)
    )
    const id = created.ok ? created.data.id : ''
    await signInWith('viewer', ['suppliers.view', 'purchases.view'])
    expect(await invoke(IPC_CHANNELS.suppliersList, {})).toMatchObject({ ok: true })
    expect(await invoke(IPC_CHANNELS.purchasesList, {})).toMatchObject({ ok: true })
    expect(await invoke(IPC_CHANNELS.purchasesGet, { id })).toMatchObject({ ok: true })
    expect(await invoke(IPC_CHANNELS.purchasesSummary)).toMatchObject({ ok: true })
    const denied: [string, unknown][] = [
      [IPC_CHANNELS.suppliersCreate, { name: 'Other' }],
      [IPC_CHANNELS.suppliersDelete, { id: supplierId }],
      [IPC_CHANNELS.suppliersSetActive, { id: supplierId, isActive: false }],
      [IPC_CHANNELS.purchasesCreate, draftInput(supplierId, item.id)],
      [IPC_CHANNELS.purchasesReceive, { id }],
      [IPC_CHANNELS.purchasesCancel, { id, reason: 'No' }],
      [IPC_CHANNELS.purchasesRecordPayment, { purchaseId: id, amount: 100, method: 'CASH' }],
      [IPC_CHANNELS.purchasesVoidPayment, { id, reason: 'No' }]
    ]
    for (const [channel, payload] of denied) {
      expect(errorCode(await invoke(channel, payload)), channel).toBe('FORBIDDEN')
    }
  })

  it('lets purchasing staff buy and receive but not pay or set up suppliers', async () => {
    const { supplierId, item } = await seed()
    await signInWith('buyer', ['purchases.operate'])
    // Operating implies seeing purchases, suppliers and stock.
    expect(await invoke(IPC_CHANNELS.suppliersList, {})).toMatchObject({ ok: true })
    const created = await invoke<Purchase>(
      IPC_CHANNELS.purchasesCreate,
      draftInput(supplierId, item.id)
    )
    expect(created).toMatchObject({ ok: true })
    const id = created.ok ? created.data.id : ''
    expect(await invoke(IPC_CHANNELS.purchasesReceive, { id })).toMatchObject({
      ok: true,
      data: { status: 'RECEIVED' }
    })
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.purchasesRecordPayment, {
          purchaseId: id,
          amount: 100,
          method: 'CASH'
        })
      )
    ).toBe('FORBIDDEN')
    expect(errorCode(await invoke(IPC_CHANNELS.suppliersCreate, { name: 'Other' }))).toBe(
      'FORBIDDEN'
    )
  })

  it('lets accounts staff pay suppliers but not receive stock', async () => {
    const { supplierId, item } = await seed()
    const created = await invoke<Purchase>(
      IPC_CHANNELS.purchasesCreate,
      draftInput(supplierId, item.id)
    )
    const id = created.ok ? created.data.id : ''
    await invoke(IPC_CHANNELS.purchasesReceive, { id })
    await signInWith('accounts', ['purchases.pay'])
    // Paying implies seeing purchases.
    expect(await invoke(IPC_CHANNELS.purchasesGet, { id })).toMatchObject({ ok: true })
    expect(
      await invoke(IPC_CHANNELS.purchasesRecordPayment, {
        purchaseId: id,
        amount: 60000,
        method: 'BANK',
        reference: 'NEFT-1'
      })
    ).toMatchObject({ ok: true, data: { paymentStatus: 'PAID' } })
    expect(errorCode(await invoke(IPC_CHANNELS.purchasesReceive, { id }))).toBe('FORBIDDEN')
    expect(errorCode(await invoke(IPC_CHANNELS.suppliersList, {}))).toBe('FORBIDDEN')
  })

  it('lets a manager keep suppliers', async () => {
    await signInWith('supplier-admin', ['suppliers.manage'])
    const created = await invoke<Supplier>(IPC_CHANNELS.suppliersCreate, { name: 'Gupta Spices' })
    expect(created).toMatchObject({ ok: true, data: { name: 'Gupta Spices' } })
    const id = created.ok ? created.data.id : ''
    expect(await invoke(IPC_CHANNELS.suppliersList, {})).toMatchObject({ ok: true })
    expect(
      await invoke(IPC_CHANNELS.suppliersUpdate, { id, name: 'Gupta Spices', phone: '9876543210' })
    ).toMatchObject({ ok: true, data: { phone: '9876543210' } })
    expect(await invoke(IPC_CHANNELS.suppliersSetActive, { id, isActive: false })).toMatchObject({
      ok: true,
      data: { isActive: false }
    })
    expect(await invoke(IPC_CHANNELS.suppliersDelete, { id })).toMatchObject({ ok: true })
    expect(errorCode(await invoke(IPC_CHANNELS.purchasesList, {}))).toBe('FORBIDDEN')
  })
})
