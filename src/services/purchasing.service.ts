import type {
  CancelPurchaseInput,
  CreatePurchaseInput,
  CreateSupplierInput,
  Purchase,
  PurchaseFilterInput,
  PurchaseSummary,
  PurchasingSummary,
  RecordPaymentInput,
  SetSupplierActiveInput,
  Supplier,
  SupplierFilterInput,
  UpdatePurchaseInput,
  UpdateSupplierInput,
  VoidPaymentInput
} from '@shared/purchasing'
import { getApi, unwrap } from '@/lib/ipc'

export const supplierService = {
  list: (filter: SupplierFilterInput = {}): Promise<Supplier[]> =>
    unwrap(getApi().suppliers.list(filter)),
  create: (input: CreateSupplierInput): Promise<Supplier> =>
    unwrap(getApi().suppliers.create(input)),
  update: (input: UpdateSupplierInput): Promise<Supplier> =>
    unwrap(getApi().suppliers.update(input)),
  setActive: (input: SetSupplierActiveInput): Promise<Supplier> =>
    unwrap(getApi().suppliers.setActive(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().suppliers.delete(id))
}

export const purchaseService = {
  summary: (): Promise<PurchasingSummary> => unwrap(getApi().purchases.summary()),
  list: (filter: PurchaseFilterInput = {}): Promise<PurchaseSummary[]> =>
    unwrap(getApi().purchases.list(filter)),
  get: (id: string): Promise<Purchase> => unwrap(getApi().purchases.get(id)),
  create: (input: CreatePurchaseInput): Promise<Purchase> =>
    unwrap(getApi().purchases.create(input)),
  update: (input: UpdatePurchaseInput): Promise<Purchase> =>
    unwrap(getApi().purchases.update(input)),
  receive: (id: string): Promise<Purchase> => unwrap(getApi().purchases.receive(id)),
  cancel: (input: CancelPurchaseInput): Promise<Purchase> =>
    unwrap(getApi().purchases.cancel(input)),
  recordPayment: (input: RecordPaymentInput): Promise<Purchase> =>
    unwrap(getApi().purchases.recordPayment(input)),
  voidPayment: (input: VoidPaymentInput): Promise<Purchase> =>
    unwrap(getApi().purchases.voidPayment(input))
}
