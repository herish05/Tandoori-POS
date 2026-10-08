import { IPC_CHANNELS } from '@shared/ipc-channels'
import { idInputSchema } from '@shared/auth-schemas'
import {
  cancelPurchaseInputSchema,
  createPurchaseInputSchema,
  createSupplierInputSchema,
  purchaseFilterSchema,
  recordPaymentInputSchema,
  setSupplierActiveInputSchema,
  supplierFilterSchema,
  updatePurchaseInputSchema,
  updateSupplierInputSchema,
  voidPaymentInputSchema
} from '@shared/purchasing'
import { emptyInputSchema } from '@shared/schemas'
import type { IpcRegistrar } from './ipc/registrar'
import type { Services } from './services'

const SUPPLIERS_VIEW = { permissions: ['suppliers.view'] } as const
const SUPPLIERS_MANAGE = { permissions: ['suppliers.manage'] } as const
const PURCHASES_VIEW = { permissions: ['purchases.view'] } as const
const PURCHASES_OPERATE = { permissions: ['purchases.operate'] } as const
const PURCHASES_PAY = { permissions: ['purchases.pay'] } as const

/** Supplier and purchase handlers: the supplier master, purchase drafts, receiving and payments. */
export function registerPurchasingHandlers(registrar: IpcRegistrar, services: Services): void {
  const { suppliers, purchases } = services

  registrar.handleProtected(
    IPC_CHANNELS.suppliersList,
    supplierFilterSchema,
    SUPPLIERS_VIEW,
    (input) => suppliers.list(input)
  )
  registrar.handleProtected(IPC_CHANNELS.suppliersGet, idInputSchema, SUPPLIERS_VIEW, (input) =>
    suppliers.get(input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.suppliersCreate,
    createSupplierInputSchema,
    SUPPLIERS_MANAGE,
    (input, ctx) => suppliers.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.suppliersUpdate,
    updateSupplierInputSchema,
    SUPPLIERS_MANAGE,
    (input, ctx) => suppliers.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.suppliersSetActive,
    setSupplierActiveInputSchema,
    SUPPLIERS_MANAGE,
    (input, ctx) => suppliers.setActive(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.suppliersDelete,
    idInputSchema,
    SUPPLIERS_MANAGE,
    (input, ctx) => suppliers.delete(ctx, input.id)
  )

  registrar.handleProtected(IPC_CHANNELS.purchasesSummary, emptyInputSchema, PURCHASES_VIEW, () =>
    purchases.summary()
  )
  registrar.handleProtected(
    IPC_CHANNELS.purchasesList,
    purchaseFilterSchema,
    PURCHASES_VIEW,
    (input) => purchases.list(input)
  )
  registrar.handleProtected(IPC_CHANNELS.purchasesGet, idInputSchema, PURCHASES_VIEW, (input) =>
    purchases.get(input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.purchasesCreate,
    createPurchaseInputSchema,
    PURCHASES_OPERATE,
    (input, ctx) => purchases.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.purchasesUpdate,
    updatePurchaseInputSchema,
    PURCHASES_OPERATE,
    (input, ctx) => purchases.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.purchasesReceive,
    idInputSchema,
    PURCHASES_OPERATE,
    (input, ctx) => purchases.receive(ctx, input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.purchasesCancel,
    cancelPurchaseInputSchema,
    PURCHASES_OPERATE,
    (input, ctx) => purchases.cancel(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.purchasesRecordPayment,
    recordPaymentInputSchema,
    PURCHASES_PAY,
    (input, ctx) => purchases.recordPayment(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.purchasesVoidPayment,
    voidPaymentInputSchema,
    PURCHASES_PAY,
    (input, ctx) => purchases.voidPayment(ctx, input)
  )
}
