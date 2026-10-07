import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import type {
  BillDetail,
  BillSummary,
  BillingSettings,
  PayBillResult,
  RefundBillResult
} from '@shared/billing'
import type { ReceiptPreview, ReceiptPrintOutcome } from '@shared/receipts'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { createCategoryInputSchema, createItemInputSchema } from '@shared/menu'
import { createOrderInputSchema, setOrderStatusInputSchema } from '@shared/orders'
import type { PermissionCode } from '@shared/permissions'
import type { IpcResult } from '@shared/types'
import { registerAuthHandlers } from '@main/auth-handlers'
import { registerBillingHandlers } from '@main/billing-handlers'
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

describe('billing IPC', () => {
  let app: TestApp
  let itemId: string

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

  /** A served takeaway order for the item, made as the owner. */
  const servedOrder = (): string => {
    const owner = app.services.auth.authorize([])
    const order = app.services.orders.create(
      owner,
      createOrderInputSchema.parse({
        type: 'TAKEAWAY',
        lines: [{ menuItemId: itemId, quantity: 2 }]
      })
    )
    app.services.orders.sendAndGetKots(owner, order.id)
    app.services.orders.setStatus(
      owner,
      setOrderStatusInputSchema.parse({ id: order.id, status: 'SERVED' })
    )
    return order.id
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
    registerBillingHandlers(registrar, app.services)

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

  it('needs a session', async () => {
    app.services.auth.logout()
    for (const channel of [
      IPC_CHANNELS.billingSettingsGet,
      IPC_CHANNELS.billsList,
      IPC_CHANNELS.billsGet,
      IPC_CHANNELS.billsGenerate,
      IPC_CHANNELS.billsPay
    ]) {
      expect(errorCode(await invoke(channel, {}))).toBe('UNAUTHENTICATED')
    }
  })

  it('lets the owner make, discount, pay and list a bill over IPC', async () => {
    const orderId = servedOrder()
    const generated = await invoke<BillDetail>(IPC_CHANNELS.billsGenerate, { orderId })
    expect(generated).toMatchObject({ ok: true, data: { subtotal: 40000, grandTotal: 40000 } })
    const bill = (generated as { ok: true; data: BillDetail }).data

    const discounted = await invoke<BillDetail>(IPC_CHANNELS.billsApplyDiscount, {
      billId: bill.id,
      scope: 'BILL',
      type: 'FIXED',
      value: 5000,
      reason: 'Regular guest'
    })
    expect(discounted).toMatchObject({ ok: true, data: { grandTotal: 35000 } })

    const paid = await invoke<PayBillResult>(IPC_CHANNELS.billsPay, {
      billId: bill.id,
      payments: [
        { method: 'UPI', amount: 20000 },
        { method: 'CASH', amount: 15000, tendered: 20000 }
      ]
    })
    expect(paid).toMatchObject({
      ok: true,
      data: { changeDue: 5000, bill: { status: 'PAID', paidTotal: 35000 } }
    })
    const listed = await invoke<BillSummary[]>(IPC_CHANNELS.billsList, { statuses: ['PAID'] })
    expect(listed).toMatchObject({ ok: true, data: [{ id: bill.id }] })
    expect(await invoke(IPC_CHANNELS.billsGet, { id: bill.id })).toMatchObject({ ok: true })
  })

  it('validates input and never trusts totals sent by the screen', async () => {
    expect(errorCode(await invoke(IPC_CHANNELS.billsGenerate, { orderId: 'nope' }))).toBe(
      'VALIDATION_ERROR'
    )
    const generated = await invoke<BillDetail>(IPC_CHANNELS.billsGenerate, {
      orderId: servedOrder(),
      grandTotal: 1,
      subtotal: 1
    })
    expect(generated).toMatchObject({ ok: true, data: { subtotal: 40000, grandTotal: 40000 } })
    const bill = (generated as { ok: true; data: BillDetail }).data
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.billsPay, {
          billId: bill.id,
          payments: [{ method: 'CASH', amount: -5 }]
        })
      )
    ).toBe('VALIDATION_ERROR')
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.billsPay, {
          billId: bill.id,
          payments: [{ method: 'CASH', amount: 40001 }]
        })
      )
    ).toBe('VALIDATION_ERROR')
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.billsApplyDiscount, {
          billId: bill.id,
          scope: 'BILL',
          type: 'PERCENTAGE',
          value: 500,
          reason: 'x'
        })
      )
    ).toBe('VALIDATION_ERROR')
  })

  it('lets a view-only user read bills but not change them', async () => {
    const orderId = servedOrder()
    const bill = (
      (await invoke<BillDetail>(IPC_CHANNELS.billsGenerate, { orderId })) as {
        ok: true
        data: BillDetail
      }
    ).data
    await signInWith('viewer', ['billing.view'])
    expect(await invoke(IPC_CHANNELS.billsList, {})).toMatchObject({ ok: true })
    expect(await invoke(IPC_CHANNELS.billsGet, { id: bill.id })).toMatchObject({ ok: true })
    expect(await invoke(IPC_CHANNELS.billingSettingsGet)).toMatchObject({ ok: true })
    expect(errorCode(await invoke(IPC_CHANNELS.billsGenerate, { orderId }))).toBe('FORBIDDEN')
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.billsPay, {
          billId: bill.id,
          payments: [{ method: 'CASH', amount: 100 }]
        })
      )
    ).toBe('FORBIDDEN')
    expect(
      errorCode(await invoke(IPC_CHANNELS.billsCancel, { id: bill.id, reason: 'Mistake' }))
    ).toBe('FORBIDDEN')
  })

  it('lets a cashier take payment but not give discounts', async () => {
    const orderId = servedOrder()
    await signInWith('cashier', ['billing.view', 'billing.operate'])
    const generated = await invoke<BillDetail>(IPC_CHANNELS.billsGenerate, { orderId })
    expect(generated.ok).toBe(true)
    const bill = (generated as { ok: true; data: BillDetail }).data
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.billsApplyDiscount, {
          billId: bill.id,
          scope: 'BILL',
          type: 'PERCENTAGE',
          value: 1000,
          reason: 'Friend of owner'
        })
      )
    ).toBe('FORBIDDEN')
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.billsRemoveDiscount, {
          billId: bill.id,
          discountId: crypto.randomUUID()
        })
      )
    ).toBe('FORBIDDEN')
    expect(
      await invoke(IPC_CHANNELS.billsPay, {
        billId: bill.id,
        payments: [{ method: 'CASH', amount: 40000 }]
      })
    ).toMatchObject({ ok: true })
  })

  it('treats the discount permission as including the right to bill', async () => {
    const orderId = servedOrder()
    await signInWith('supervisor', ['billing.discount'])
    const generated = await invoke<BillDetail>(IPC_CHANNELS.billsGenerate, { orderId })
    expect(generated.ok).toBe(true)
    const bill = (generated as { ok: true; data: BillDetail }).data
    expect(
      await invoke(IPC_CHANNELS.billsApplyDiscount, {
        billId: bill.id,
        scope: 'BILL',
        type: 'PERCENTAGE',
        value: 1000,
        reason: 'Regular guest'
      })
    ).toMatchObject({ ok: true, data: { grandTotal: 36000 } })
  })

  it('lets only a manager change the billing settings', async () => {
    const next = {
      taxMode: 'INTRA_STATE',
      serviceChargeBps: 500,
      serviceChargeDineInOnly: true,
      serviceChargeTaxable: true,
      roundOffUnit: 10
    }
    await signInWith('cashier', ['billing.view', 'billing.operate', 'billing.discount'])
    expect(errorCode(await invoke(IPC_CHANNELS.billingSettingsUpdate, next))).toBe('FORBIDDEN')
    app.services.auth.logout()
    await loginAsOwner(app)
    expect(await invoke<BillingSettings>(IPC_CHANNELS.billingSettingsUpdate, next)).toMatchObject({
      ok: true,
      data: { serviceChargeBps: 500, roundOffUnit: 10 }
    })
    expect(
      errorCode(await invoke(IPC_CHANNELS.billingSettingsUpdate, { ...next, roundOffUnit: 7 }))
    ).toBe('VALIDATION_ERROR')
  })

  it('gives a user with no billing permission no access at all', async () => {
    await signInWith('waiter', ['orders.view'])
    expect(errorCode(await invoke(IPC_CHANNELS.billsList, {}))).toBe('FORBIDDEN')
    expect(
      errorCode(await invoke(IPC_CHANNELS.billsGenerate, { orderId: crypto.randomUUID() }))
    ).toBe('FORBIDDEN')
    expect(
      errorCode(await invoke(IPC_CHANNELS.receiptsPreview, { billId: crypto.randomUUID() }))
    ).toBe('FORBIDDEN')
  })

  /** A paid bill (cash) made as the owner, then the owner signs out. */
  const paidBill = async (): Promise<BillDetail> => {
    const generated = await invoke<BillDetail>(IPC_CHANNELS.billsGenerate, {
      orderId: servedOrder()
    })
    const bill = (generated as { ok: true; data: BillDetail }).data
    const paid = await invoke<PayBillResult>(IPC_CHANNELS.billsPay, {
      billId: bill.id,
      payments: [{ method: 'CASH', amount: 40000 }]
    })
    return (paid as { ok: true; data: PayBillResult }).data.bill
  }

  const refundInput = (billId: string) => ({
    billId,
    reason: 'Guest unhappy',
    lines: [{ method: 'CASH', amount: 10000 }]
  })

  it('lets only someone with the refund permission give money back', async () => {
    const bill = await paidBill()
    await signInWith('cashier', ['billing.view', 'billing.operate', 'billing.discount'])
    expect(errorCode(await invoke(IPC_CHANNELS.billsRefund, refundInput(bill.id)))).toBe(
      'FORBIDDEN'
    )
    app.services.auth.logout()
    await loginAsOwner(app)
    await signInWith('manager', ['billing.refund'])
    // The refund permission includes viewing bills.
    expect(await invoke(IPC_CHANNELS.billsGet, { id: bill.id })).toMatchObject({ ok: true })
    const refunded = await invoke<RefundBillResult>(IPC_CHANNELS.billsRefund, refundInput(bill.id))
    expect(refunded).toMatchObject({
      ok: true,
      data: { billCancelled: false, bill: { refundedTotal: 10000, status: 'PAID' } }
    })
  })

  it('validates a refund before it reaches the service', async () => {
    const bill = await paidBill()
    expect(errorCode(await invoke(IPC_CHANNELS.billsRefund, { billId: bill.id }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(
      errorCode(await invoke(IPC_CHANNELS.billsRefund, { ...refundInput(bill.id), lines: [] }))
    ).toBe('VALIDATION_ERROR')
    expect(
      errorCode(await invoke(IPC_CHANNELS.billsRefund, { ...refundInput(bill.id), reason: 'x' }))
    ).toBe('VALIDATION_ERROR')
    expect(
      errorCode(
        await invoke(IPC_CHANNELS.billsRefund, {
          ...refundInput(bill.id),
          lines: [{ method: 'CASH', amount: 40001 }]
        })
      )
    ).toBe('VALIDATION_ERROR')
  })

  it('previews and lists receipts for viewers, and prints only for those who operate', async () => {
    const bill = await paidBill()
    await signInWith('viewer', ['billing.view'])
    const preview = await invoke<ReceiptPreview>(IPC_CHANNELS.receiptsPreview, {
      billId: bill.id,
      paperWidth: 58
    })
    expect(preview).toMatchObject({ ok: true, data: { paperWidth: 58, columns: 32 } })
    expect(await invoke(IPC_CHANNELS.receiptsHistory, { id: bill.id })).toMatchObject({
      ok: true,
      data: []
    })
    expect(errorCode(await invoke(IPC_CHANNELS.receiptsPrint, { billId: bill.id }))).toBe(
      'FORBIDDEN'
    )
    app.services.auth.logout()
    await loginAsOwner(app)
    await signInWith('cashier', ['billing.view', 'billing.operate'])
    // No printer is set up, so nothing prints, but the attempt is answered and recorded.
    const printed = await invoke<ReceiptPrintOutcome>(IPC_CHANNELS.receiptsPrint, {
      billId: bill.id
    })
    expect(printed).toMatchObject({ ok: true, data: { status: 'FAILED' } })
    expect(await invoke(IPC_CHANNELS.receiptsHistory, { id: bill.id })).toMatchObject({
      ok: true,
      data: [{ status: 'FAILED' }]
    })
    expect(errorCode(await invoke(IPC_CHANNELS.receiptsPreview, { billId: 'nope' }))).toBe(
      'VALIDATION_ERROR'
    )
    expect(
      errorCode(await invoke(IPC_CHANNELS.receiptsPreview, { billId: bill.id, paperWidth: 72 }))
    ).toBe('VALIDATION_ERROR')
  })
})
