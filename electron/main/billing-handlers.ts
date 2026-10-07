import { IPC_CHANNELS } from '@shared/ipc-channels'
import { idInputSchema } from '@shared/auth-schemas'
import {
  applyDiscountInputSchema,
  billFilterSchema,
  cancelBillInputSchema,
  generateBillInputSchema,
  payBillInputSchema,
  refundBillInputSchema,
  removeDiscountInputSchema,
  updateBillingSettingsInputSchema
} from '@shared/billing'
import { printReceiptInputSchema, receiptPreviewInputSchema } from '@shared/receipts'
import { emptyInputSchema } from '@shared/schemas'
import type { IpcRegistrar } from './ipc/registrar'
import type { Services } from './services'

const VIEW_BILLS = { permissions: ['billing.view'] } as const
const OPERATE_BILLS = { permissions: ['billing.operate'] } as const
const GIVE_DISCOUNTS = { permissions: ['billing.discount'] } as const
const MANAGE_BILLING = { permissions: ['billing.manage'] } as const
const REFUND_BILLS = { permissions: ['billing.refund'] } as const
/** Anyone who bills needs the settings in force, and so does anyone who can manage them. */
const ANY_SIGNED_IN = { permissions: [] } as const

/** Bills, payments and the billing settings. */
export function registerBillingHandlers(registrar: IpcRegistrar, services: Services): void {
  const { bills, billingSettings, receipts } = services

  registrar.handleProtected(IPC_CHANNELS.billingSettingsGet, emptyInputSchema, ANY_SIGNED_IN, () =>
    billingSettings.get()
  )
  registrar.handleProtected(
    IPC_CHANNELS.billingSettingsUpdate,
    updateBillingSettingsInputSchema,
    MANAGE_BILLING,
    (input, auth) => billingSettings.update(auth, input)
  )

  registrar.handleProtected(IPC_CHANNELS.billsList, billFilterSchema, VIEW_BILLS, (input) =>
    bills.list(input)
  )
  registrar.handleProtected(IPC_CHANNELS.billsGet, idInputSchema, VIEW_BILLS, (input) =>
    bills.get(input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.billsGenerate,
    generateBillInputSchema,
    OPERATE_BILLS,
    (input, auth) => bills.generate(auth, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.billsApplyDiscount,
    applyDiscountInputSchema,
    GIVE_DISCOUNTS,
    (input, auth) => bills.applyDiscount(auth, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.billsRemoveDiscount,
    removeDiscountInputSchema,
    GIVE_DISCOUNTS,
    (input, auth) => bills.removeDiscount(auth, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.billsCancel,
    cancelBillInputSchema,
    OPERATE_BILLS,
    (input, auth) => bills.cancel(auth, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.billsPay,
    payBillInputSchema,
    OPERATE_BILLS,
    (input, auth) => bills.pay(auth, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.billsRefund,
    refundBillInputSchema,
    REFUND_BILLS,
    (input, auth) => bills.refund(auth, input)
  )

  registrar.handleProtected(
    IPC_CHANNELS.receiptsPreview,
    receiptPreviewInputSchema,
    VIEW_BILLS,
    (input) => receipts.preview(input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.receiptsPrint,
    printReceiptInputSchema,
    OPERATE_BILLS,
    (input, auth) => receipts.print(auth, input)
  )
  registrar.handleProtected(IPC_CHANNELS.receiptsHistory, idInputSchema, VIEW_BILLS, (input) =>
    receipts.history(input.id)
  )
}
