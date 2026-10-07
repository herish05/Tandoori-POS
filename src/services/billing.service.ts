import type {
  ApplyDiscountInput,
  BillDetail,
  BillFilterInput,
  BillSummary,
  BillingSettings,
  CancelBillInput,
  GenerateBillInput,
  PayBillInput,
  PayBillResult,
  RefundBillInput,
  RefundBillResult,
  RemoveDiscountInput,
  UpdateBillingSettingsInput
} from '@shared/billing'
import type {
  PrintReceiptInput,
  ReceiptPreview,
  ReceiptPreviewInput,
  ReceiptPrintOutcome,
  ReceiptPrintRecord
} from '@shared/receipts'
import { getApi, unwrap } from '@/lib/ipc'

export const billService = {
  list: (filter: BillFilterInput = {}): Promise<BillSummary[]> =>
    unwrap(getApi().bills.list(filter)),
  get: (id: string): Promise<BillDetail> => unwrap(getApi().bills.get(id)),
  generate: (input: GenerateBillInput): Promise<BillDetail> =>
    unwrap(getApi().bills.generate(input)),
  applyDiscount: (input: ApplyDiscountInput): Promise<BillDetail> =>
    unwrap(getApi().bills.applyDiscount(input)),
  removeDiscount: (input: RemoveDiscountInput): Promise<BillDetail> =>
    unwrap(getApi().bills.removeDiscount(input)),
  cancel: (input: CancelBillInput): Promise<BillDetail> => unwrap(getApi().bills.cancel(input)),
  pay: (input: PayBillInput): Promise<PayBillResult> => unwrap(getApi().bills.pay(input)),
  refund: (input: RefundBillInput): Promise<RefundBillResult> =>
    unwrap(getApi().bills.refund(input))
}

export const receiptService = {
  preview: (input: ReceiptPreviewInput): Promise<ReceiptPreview> =>
    unwrap(getApi().receipts.preview(input)),
  print: (input: PrintReceiptInput): Promise<ReceiptPrintOutcome> =>
    unwrap(getApi().receipts.print(input)),
  history: (billId: string): Promise<ReceiptPrintRecord[]> =>
    unwrap(getApi().receipts.history(billId))
}

export const billingSettingsService = {
  get: (): Promise<BillingSettings> => unwrap(getApi().billing.settings()),
  update: (input: UpdateBillingSettingsInput): Promise<BillingSettings> =>
    unwrap(getApi().billing.updateSettings(input))
}
