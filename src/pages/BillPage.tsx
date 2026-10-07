import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Ban,
  BadgeCheck,
  Loader2,
  Percent,
  Printer,
  Tag,
  Undo2,
  Wallet,
  X
} from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  BILL_STATUS_LABELS,
  CHANGEABLE_BILL_STATUSES,
  PAYABLE_BILL_STATUSES,
  PAYMENT_METHOD_LABELS,
  TAX_MODE_LABELS,
  type BillDetail,
  type BillTaxLine
} from '@shared/billing'
import { ORDER_TYPE_LABELS } from '@shared/orders'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney, formatPercent } from '@/lib/money'
import { BILL_STATUS_TONE } from '@/modules/billing/bill-status'
import { DiscountDialog, type DiscountTarget } from '@/modules/billing/DiscountDialog'
import { BILL_KEYS, BILL_REFRESH_MS, RECEIPT_KEYS, useRefreshBills } from '@/modules/billing/hooks'
import { PaymentDialog } from '@/modules/billing/PaymentDialog'
import { ReceiptPreviewDialog } from '@/modules/billing/ReceiptPreviewDialog'
import { RefundDialog } from '@/modules/billing/RefundDialog'
import { ReasonDialog } from '@/modules/orders/ReasonDialog'
import { billingSettingsService, billService, receiptService } from '@/services/billing.service'
import { usePermission } from '@/stores/auth.store'

/** The label of a GST line: an even rate is shown as its half (CGST 2.5%), as it is printed. */
function taxLabel(tax: BillTaxLine): string {
  if (tax.component === 'IGST') return `IGST ${formatPercent(tax.rateBps)}`
  return tax.rateBps % 2 === 0
    ? `${tax.component} ${formatPercent(tax.rateBps / 2)}`
    : `${tax.component} (half of ${formatPercent(tax.rateBps)})`
}

/** One bill: the lines, discounts, taxes and payments, with the actions that are allowed right now. */
export function BillPage() {
  const { billId } = useParams()
  const query = useQuery({
    queryKey: BILL_KEYS.detail(billId ?? ''),
    queryFn: () => billService.get(billId ?? ''),
    enabled: Boolean(billId),
    staleTime: 0,
    refetchInterval: BILL_REFRESH_MS,
    retry: false
  })

  if (query.isPending) return <Skeleton className="mx-auto h-96 max-w-5xl" />
  if (query.isError) {
    return (
      <div className="mx-auto max-w-lg space-y-3 py-10 text-center">
        <p role="alert" className="font-medium text-destructive">
          {toUserMessage(query.error)}
        </p>
        <BackLink />
      </div>
    )
  }
  return <BillScreen bill={query.data} />
}

function BackLink() {
  const location = useLocation()
  const admin = location.pathname.startsWith('/admin')
  return (
    <Button asChild variant="ghost" size="sm">
      <Link to={admin ? '/admin/bills' : '/pos'}>
        <ArrowLeft /> {admin ? 'All bills' : 'Back to tables'}
      </Link>
    </Button>
  )
}

function BillScreen({ bill }: { bill: BillDetail }) {
  const queryClient = useQueryClient()
  const refresh = useRefreshBills()
  const canOperate = usePermission('billing.operate')
  const canDiscount = usePermission('billing.discount')
  const canRefund = usePermission('billing.refund')
  const canViewOrders = usePermission('orders.view')
  const canUsePos = usePermission('pos.access')
  const canOpenOrder = canViewOrders && canUsePos

  const [discounting, setDiscounting] = useState<DiscountTarget | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [paying, setPaying] = useState(false)
  const [change, setChange] = useState<number | null>(null)
  const [refunding, setRefunding] = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [refundNotice, setRefundNotice] = useState<string | null>(null)

  const settings = useQuery({
    queryKey: BILL_KEYS.settings,
    queryFn: billingSettingsService.get,
    staleTime: 60_000
  })
  const history = useQuery({
    queryKey: RECEIPT_KEYS.history(bill.id),
    queryFn: () => receiptService.history(bill.id),
    staleTime: 0
  })
  const autoPrint = useMutation({
    mutationFn: receiptService.print,
    onSuccess: refresh
  })

  const saved = async (next: BillDetail): Promise<void> => {
    queryClient.setQueryData(BILL_KEYS.detail(next.id), next)
    await refresh()
  }

  const apply = useMutation({
    mutationFn: billService.applyDiscount,
    onSuccess: async (next) => {
      await saved(next)
      setDiscounting(null)
    }
  })
  const remove = useMutation({
    mutationFn: billService.removeDiscount,
    onSuccess: saved
  })
  const cancel = useMutation({
    mutationFn: billService.cancel,
    onSuccess: async (next) => {
      await saved(next)
      setCancelling(false)
    }
  })
  const pay = useMutation({
    mutationFn: billService.pay,
    onSuccess: async (result) => {
      await saved(result.bill)
      setChange(result.changeDue)
      setPaying(false)
      if (canOperate && settings.data?.autoPrintReceipt === true) {
        autoPrint.mutate({ billId: result.bill.id })
      }
    }
  })
  const refund = useMutation({
    mutationFn: billService.refund,
    onSuccess: async (result) => {
      await saved(result.bill)
      setRefunding(false)
      setRefundNotice(
        result.billCancelled
          ? `Refunded ${formatMoney(result.refund.amount)} (${result.refund.refundNumber}). The bill was withdrawn; the order can be billed again.`
          : `Refunded ${formatMoney(result.refund.amount)} (${result.refund.refundNumber}).`
      )
    }
  })

  const changeable = CHANGEABLE_BILL_STATUSES.includes(bill.status)
  const payable = PAYABLE_BILL_STATUSES.includes(bill.status)
  const itemDiscounts = bill.discounts.filter((entry) => entry.scope === 'ITEM')
  const billDiscount = bill.discounts.find((entry) => entry.scope === 'BILL')
  const removeError = remove.isError ? toUserMessage(remove.error) : undefined

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <BackLink />
          <h2 className="flex flex-wrap items-center gap-3 text-xl font-bold">
            <span data-testid="bill-number">{bill.billNumber}</span>
            <Badge variant={BILL_STATUS_TONE[bill.status]} data-testid="bill-status">
              {BILL_STATUS_LABELS[bill.status]}
            </Badge>
          </h2>
          <p className="text-sm text-muted-foreground">
            Order {bill.orderNumber} · {ORDER_TYPE_LABELS[bill.orderType]}
            {bill.tableNumber ? ` · Table ${bill.tableNumber}` : ''}
            {bill.customerName ? ` · ${bill.customerName}` : ''} · {formatDateTime(bill.createdAt)}{' '}
            by {bill.createdByName}
          </p>
        </div>
        {canOpenOrder && (
          <Button asChild variant="outline" size="sm">
            <Link to={`/pos/orders/${bill.orderId}`}>View order</Link>
          </Button>
        )}
      </div>

      {change !== null && bill.status === 'PAID' && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm"
        >
          <BadgeCheck className="size-5 text-success" aria-hidden />
          <span className="font-semibold">Payment complete.</span>
          {change > 0 && (
            <span data-testid="change-due">
              Give <strong>{formatMoney(change)}</strong> back to the guest.
            </span>
          )}
          {autoPrint.isPending && <span>Printing the receipt…</span>}
          {autoPrint.data?.status === 'PRINTED' && (
            <span data-testid="auto-print-status">Receipt printed.</span>
          )}
          {(autoPrint.data?.status === 'FAILED' || autoPrint.isError) && (
            <span role="alert" className="font-medium text-destructive">
              The receipt could not be printed. Open it to print again.
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setReceiptOpen(true)
            }}
          >
            <Printer /> Receipt
          </Button>
        </div>
      )}
      {refundNotice && (
        <p
          role="status"
          data-testid="refund-notice"
          className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm font-medium"
        >
          {refundNotice}
        </p>
      )}
      {bill.status === 'CANCELLED' && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          This bill was cancelled{bill.cancelledAt ? ` on ${formatDateTime(bill.cancelledAt)}` : ''}
          : {bill.cancelReason}
          {bill.refundedTotal > 0 && ` Money returned: ${formatMoney(bill.refundedTotal)}.`}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm" data-testid="bill-items">
              <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {bill.items.map((item) => {
                  const discount = itemDiscounts.find((entry) => entry.billItemId === item.id)
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        <span className="font-medium">{item.name}</span>
                        {item.variantName && (
                          <span className="text-muted-foreground"> ({item.variantName})</span>
                        )}
                        {item.taxName && (
                          <span className="block text-xs text-muted-foreground">
                            {item.taxName}
                          </span>
                        )}
                        {discount && (
                          <span className="block text-xs text-success">
                            Discount −{formatMoney(item.itemDiscount)} · {discount.reason}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{item.quantity}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(item.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatMoney(item.gross)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canDiscount && changeable && !discount && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              apply.reset()
                              setDiscounting({ billId: bill.id, scope: 'ITEM', item })
                            }}
                          >
                            <Tag /> Discount
                          </Button>
                        )}
                        {discount && changeable && canDiscount && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove the discount on ${item.name}`}
                            disabled={remove.isPending}
                            onClick={() => {
                              remove.mutate({ billId: bill.id, discountId: discount.id })
                            }}
                          >
                            <X />
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {bill.payments.length > 0 && (
            <div className="rounded-lg border bg-card">
              <h3 className="border-b px-3 py-2 text-sm font-semibold">Payments</h3>
              <ul className="divide-y text-sm" data-testid="bill-payments">
                {bill.payments.map((payment) => (
                  <li
                    key={payment.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span>
                      <span className="font-medium">{PAYMENT_METHOD_LABELS[payment.method]}</span>
                      {payment.reference && (
                        <span className="text-muted-foreground"> · {payment.reference}</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTime(payment.receivedAt)} · {payment.receivedByName}
                        {payment.change > 0
                          ? ` · ${formatMoney(payment.tendered)} received, ${formatMoney(payment.change)} given back`
                          : ''}
                      </span>
                    </span>
                    <span className="font-semibold">{formatMoney(payment.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {bill.refunds.length > 0 && (
            <div className="rounded-lg border bg-card">
              <h3 className="border-b px-3 py-2 text-sm font-semibold">Refunds</h3>
              <ul className="divide-y text-sm" data-testid="bill-refunds">
                {bill.refunds.map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <span>
                      <span className="font-medium">{entry.refundNumber}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {entry.lines.map((line) => PAYMENT_METHOD_LABELS[line.method]).join(', ')}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTime(entry.refundedAt)} · {entry.refundedByName} · {entry.reason}
                      </span>
                    </span>
                    <span className="font-semibold text-destructive">
                      −{formatMoney(entry.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {history.data && history.data.length > 0 && (
            <div className="rounded-lg border bg-card">
              <h3 className="border-b px-3 py-2 text-sm font-semibold">Receipt prints</h3>
              <ul className="divide-y text-sm" data-testid="receipt-history">
                {history.data.map((entry) => (
                  <li key={entry.id} className="px-3 py-2">
                    <span className="font-medium">
                      {entry.copyNumber > 0
                        ? `Duplicate copy ${String(entry.copyNumber)}`
                        : 'Original'}
                    </span>
                    <span
                      className={
                        entry.status === 'PRINTED' ? 'text-muted-foreground' : 'text-destructive'
                      }
                    >
                      {' '}
                      · {entry.status === 'PRINTED' ? 'printed' : 'failed'}
                      {entry.printerName ? ` on ${entry.printerName}` : ''}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(entry.printedAt)}
                      {entry.error ? ` · ${entry.error}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <aside className="space-y-3">
          <dl
            className="space-y-1.5 rounded-lg border bg-card p-4 text-sm"
            data-testid="bill-totals"
          >
            <Row label="Subtotal" value={bill.subtotal} />
            {bill.itemDiscountTotal > 0 && (
              <Row label="Item discounts" value={-bill.itemDiscountTotal} />
            )}
            {billDiscount && (
              <Row
                label={`Bill discount (${billDiscount.type === 'PERCENTAGE' ? formatPercent(billDiscount.value) : 'fixed'})`}
                value={-bill.billDiscountTotal}
                remove={
                  changeable && canDiscount
                    ? {
                        label: 'Remove the bill discount',
                        disabled: remove.isPending,
                        onRemove: () => {
                          remove.mutate({ billId: bill.id, discountId: billDiscount.id })
                        }
                      }
                    : undefined
                }
              />
            )}
            {bill.serviceCharge > 0 && (
              <Row
                label={`Service charge (${formatPercent(bill.serviceChargeBps)})`}
                value={bill.serviceCharge}
              />
            )}
            {bill.deliveryCharge > 0 && <Row label="Delivery charge" value={bill.deliveryCharge} />}
            {bill.packagingCharge > 0 && (
              <Row label="Packaging charge" value={bill.packagingCharge} />
            )}
            {bill.taxes.map((tax) => (
              <Row
                key={`${tax.component}-${String(tax.rateBps)}`}
                label={taxLabel(tax)}
                value={tax.taxAmount}
                hint={`on ${formatMoney(tax.taxableAmount)}`}
              />
            ))}
            {bill.roundOff !== 0 && <Row label="Round off" value={bill.roundOff} signed />}
            <div className="mt-2 flex items-baseline justify-between border-t pt-3 text-lg font-bold">
              <dt>Total</dt>
              <dd data-testid="bill-grand-total">{formatMoney(bill.grandTotal)}</dd>
            </div>
            {bill.paidTotal > 0 && <Row label="Paid" value={bill.paidTotal} />}
            {bill.refundedTotal > 0 && <Row label="Refunded" value={-bill.refundedTotal} />}
            {bill.refundedTotal > 0 && (
              <div className="flex justify-between font-semibold">
                <dt>Net paid</dt>
                <dd data-testid="bill-net-paid">
                  {formatMoney(bill.paidTotal - bill.refundedTotal)}
                </dd>
              </div>
            )}
            {bill.paidTotal > 0 && bill.balance > 0 && (
              <div className="flex justify-between font-semibold">
                <dt>Balance</dt>
                <dd data-testid="bill-balance">{formatMoney(bill.balance)}</dd>
              </div>
            )}
            <p className="pt-1 text-xs text-muted-foreground">{TAX_MODE_LABELS[bill.taxMode]}</p>
          </dl>

          {removeError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {removeError}
            </p>
          )}

          <div className="grid gap-2">
            {canOperate && payable && (
              <Button
                size="lg"
                disabled={pay.isPending}
                onClick={() => {
                  if (bill.balance === 0) {
                    pay.mutate({ billId: bill.id, payments: [] })
                    return
                  }
                  pay.reset()
                  setPaying(true)
                }}
              >
                {pay.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Wallet />}
                {bill.balance === 0 ? 'Close the bill' : 'Take payment'}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setReceiptOpen(true)
              }}
            >
              <Printer /> {bill.status === 'PAID' ? 'Receipt' : 'Print bill'}
            </Button>
            {canRefund && bill.refundable.length > 0 && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  refund.reset()
                  setRefundNotice(null)
                  setRefunding(true)
                }}
              >
                <Undo2 /> Refund
              </Button>
            )}
            {canDiscount && changeable && !billDiscount && (
              <Button
                variant="outline"
                onClick={() => {
                  apply.reset()
                  setDiscounting({ billId: bill.id, scope: 'BILL', item: null })
                }}
              >
                <Percent /> Discount on the bill
              </Button>
            )}
            {canOperate && changeable && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  cancel.reset()
                  setCancelling(true)
                }}
              >
                <Ban /> Cancel the bill
              </Button>
            )}
            {pay.isError && !paying && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {toUserMessage(pay.error)}
              </p>
            )}
          </div>
        </aside>
      </div>

      <DiscountDialog
        target={discounting}
        pending={apply.isPending}
        error={apply.isError ? toUserMessage(apply.error) : undefined}
        onApply={(input) => {
          apply.mutate(input)
        }}
        onClose={() => {
          setDiscounting(null)
        }}
      />
      <PaymentDialog
        open={paying}
        billNumber={bill.billNumber}
        balance={bill.balance}
        pending={pay.isPending}
        error={pay.isError ? toUserMessage(pay.error) : undefined}
        onPay={(payments) => {
          pay.mutate({ billId: bill.id, payments })
        }}
        onClose={() => {
          setPaying(false)
        }}
      />
      <ReceiptPreviewDialog
        billId={receiptOpen ? bill.id : null}
        canPrint={canOperate}
        onClose={() => {
          setReceiptOpen(false)
        }}
      />
      {refunding && (
        <RefundDialog
          open
          bill={bill}
          pending={refund.isPending}
          error={refund.isError ? toUserMessage(refund.error) : undefined}
          onRefund={(input) => {
            refund.mutate({ billId: bill.id, ...input })
          }}
          onClose={() => {
            setRefunding(false)
          }}
        />
      )}
      <ReasonDialog
        open={cancelling}
        title={`Cancel bill ${bill.billNumber}?`}
        message="The order goes back to served so it can be changed and billed again. The cancelled bill stays on record."
        confirmLabel="Cancel bill"
        required
        pending={cancel.isPending}
        error={cancel.isError ? toUserMessage(cancel.error) : undefined}
        onConfirm={(reason) => {
          cancel.mutate({ id: bill.id, reason })
        }}
        onClose={() => {
          setCancelling(false)
        }}
      />
    </div>
  )
}

interface RowProps {
  label: string
  value: number
  hint?: string
  /** Show a leading + for a positive amount (round off). */
  signed?: boolean
  remove?: { label: string; disabled: boolean; onRemove: () => void } | undefined
}

function Row({ label, value, hint, signed, remove }: RowProps) {
  const text =
    value < 0
      ? `−${formatMoney(-value)}`
      : signed && value > 0
        ? `+${formatMoney(value)}`
        : formatMoney(value)
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </dt>
      <dd className="flex items-center gap-1 font-medium">
        {text}
        {remove && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 touch:size-10"
            aria-label={remove.label}
            disabled={remove.disabled}
            onClick={remove.onRemove}
          >
            <X />
          </Button>
        )}
      </dd>
    </div>
  )
}
