import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { usePermission } from '@/stores/auth.store'
import { SUPPLIER_PAYMENT_LABELS, type Purchase } from '@shared/purchasing'
import { UNIT_LABELS, formatQuantity } from '@shared/inventory'
import { purchaseService } from '@/services/purchasing.service'
import { PURCHASING_KEYS, formatPurchaseDate, useRefreshPurchasing } from './hooks'
import { paymentStatusBadge, purchaseStatusBadge } from './badges'
import { PaymentDialog } from './PaymentDialog'
import { ReasonDialog } from './ReasonDialog'

interface PurchaseDetailDialogProps {
  /** The purchase to show; null keeps the dialog closed. */
  purchaseId: string | null
  onClose: () => void
  /** Open the form to edit this draft. */
  onEdit: (purchase: Purchase) => void
}

/** One purchase: its lines and payments, with receive, cancel and payment actions. */
export function PurchaseDetailDialog({ purchaseId, onClose, onEdit }: PurchaseDetailDialogProps) {
  return (
    <Dialog open={purchaseId !== null} title="Purchase" onClose={onClose} className="max-w-3xl">
      {purchaseId && (
        <PurchaseDetail key={purchaseId} id={purchaseId} onClose={onClose} onEdit={onEdit} />
      )}
    </Dialog>
  )
}

type Overlay = 'none' | 'receive' | 'cancel' | 'pay' | { voidPaymentId: string }

function PurchaseDetail({
  id,
  onClose,
  onEdit
}: {
  id: string
  onClose: () => void
  onEdit: (purchase: Purchase) => void
}) {
  const canOperate = usePermission('purchases.operate')
  const canPay = usePermission('purchases.pay')
  const refresh = useRefreshPurchasing()
  const [overlay, setOverlay] = useState<Overlay>('none')

  const query = useQuery({
    queryKey: PURCHASING_KEYS.detail(id),
    queryFn: () => purchaseService.get(id),
    staleTime: 0
  })

  const finish = async (): Promise<void> => {
    await refresh()
    setOverlay('none')
  }
  const receive = useMutation({ mutationFn: purchaseService.receive, onSuccess: finish })
  const cancel = useMutation({ mutationFn: purchaseService.cancel, onSuccess: finish })
  const voidPayment = useMutation({ mutationFn: purchaseService.voidPayment, onSuccess: finish })

  if (query.isPending) return <Skeleton className="h-64 w-full" />
  if (query.isError) {
    return (
      <p role="alert" className="text-sm font-medium text-destructive">
        {toUserMessage(query.error)}
      </p>
    )
  }
  const purchase = query.data
  const due = purchase.total - purchase.amountPaid
  const close = (): void => {
    setOverlay('none')
    receive.reset()
    cancel.reset()
    voidPayment.reset()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-lg font-bold" data-testid="purchase-number">
            {purchase.purchaseNumber}
          </div>
          <div className="text-sm text-muted-foreground">
            {purchase.supplierName} · {formatPurchaseDate(purchase.purchaseDate)}
            {purchase.invoiceNumber && ` · Invoice ${purchase.invoiceNumber}`}
          </div>
        </div>
        <div className="flex gap-2">
          {purchaseStatusBadge(purchase)}
          {paymentStatusBadge(purchase)}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Quantity</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {purchase.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-3 py-2 font-medium">{line.itemName}</td>
                <td className="px-3 py-2 text-right">
                  {formatQuantity(line.quantity)} {UNIT_LABELS[line.unit]}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatMoney(line.unitCost)} / {UNIT_LABELS[line.unit]}
                </td>
                <td className="px-3 py-2 text-right">{formatMoney(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <Row label="Items total" value={formatMoney(purchase.subtotal)} />
        {purchase.discount > 0 && (
          <Row label="Discount" value={`− ${formatMoney(purchase.discount)}`} />
        )}
        {purchase.tax > 0 && <Row label="Tax / freight" value={formatMoney(purchase.tax)} />}
        <div className="flex justify-between border-t pt-1 text-base font-bold">
          <span>Total</span>
          <span data-testid="purchase-total">{formatMoney(purchase.total)}</span>
        </div>
        {purchase.status === 'RECEIVED' && (
          <>
            <Row label="Paid" value={formatMoney(purchase.amountPaid)} />
            <div className="flex justify-between font-semibold">
              <span>Due</span>
              <span data-testid="purchase-due">{formatMoney(due)}</span>
            </div>
          </>
        )}
      </div>

      {purchase.notes && <p className="text-sm text-muted-foreground">Notes: {purchase.notes}</p>}
      {purchase.status === 'RECEIVED' && purchase.receivedAt && (
        <p className="text-xs text-muted-foreground">
          Received {formatDateTime(purchase.receivedAt)}. Stock and item costs were updated.
        </p>
      )}
      {purchase.status === 'CANCELLED' && (
        <p className="text-sm text-destructive">
          Cancelled{purchase.cancelledAt ? ` ${formatDateTime(purchase.cancelledAt)}` : ''}
          {purchase.cancelReason ? `: ${purchase.cancelReason}` : ''}
        </p>
      )}

      {purchase.payments.length > 0 && (
        <div className="space-y-1">
          <div className="text-sm font-medium">Payments</div>
          <ul className="divide-y rounded-lg border text-sm" data-testid="purchase-payments">
            {purchase.payments.map((payment) => {
              const voided = payment.voidedAt !== null
              return (
                <li key={payment.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className={voided ? 'text-muted-foreground line-through' : ''}>
                    <span className="font-medium">{formatMoney(payment.amount)}</span> ·{' '}
                    {SUPPLIER_PAYMENT_LABELS[payment.method]} · {formatDateTime(payment.paidAt)}
                    {payment.reference && ` · ${payment.reference}`}
                    {payment.notes && ` · ${payment.notes}`}
                  </div>
                  <div className="flex items-center gap-2">
                    {voided ? (
                      <span className="text-xs text-destructive">
                        Voided{payment.voidReason ? `: ${payment.voidReason}` : ''}
                      </span>
                    ) : (
                      canPay && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            voidPayment.reset()
                            setOverlay({ voidPaymentId: payment.id })
                          }}
                        >
                          Void
                        </Button>
                      )
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {purchase.status === 'DRAFT' && canOperate && (
          <>
            <Button
              variant="outline"
              onClick={() => {
                cancel.reset()
                setOverlay('cancel')
              }}
            >
              Cancel purchase
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                onEdit(purchase)
              }}
            >
              Edit
            </Button>
            <Button
              onClick={() => {
                receive.reset()
                setOverlay('receive')
              }}
            >
              Receive goods
            </Button>
          </>
        )}
        {purchase.status === 'RECEIVED' && canPay && due > 0 && (
          <Button
            onClick={() => {
              setOverlay('pay')
            }}
          >
            Record payment
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>

      <ConfirmDialog
        open={overlay === 'receive'}
        title="Receive goods"
        message={`Add ${String(purchase.lines.length)} item${purchase.lines.length === 1 ? '' : 's'} to stock and set their cost from this purchase? A received purchase cannot be changed afterwards.`}
        confirmLabel="Receive"
        pending={receive.isPending}
        error={receive.isError ? toUserMessage(receive.error) : undefined}
        onConfirm={() => {
          receive.mutate(purchase.id)
        }}
        onClose={close}
      />
      <ReasonDialog
        open={overlay === 'cancel'}
        title="Cancel purchase"
        description="The draft is kept on record as cancelled; nothing in stock changes."
        confirmLabel="Cancel purchase"
        pending={cancel.isPending}
        error={cancel.isError ? toUserMessage(cancel.error) : undefined}
        onConfirm={(reason) => {
          cancel.mutate({ id: purchase.id, reason })
        }}
        onClose={close}
      />
      <ReasonDialog
        open={typeof overlay === 'object'}
        title="Void payment"
        description="The payment stays on record as voided and the amount becomes due again."
        confirmLabel="Void payment"
        pending={voidPayment.isPending}
        error={voidPayment.isError ? toUserMessage(voidPayment.error) : undefined}
        onConfirm={(reason) => {
          if (typeof overlay === 'object') voidPayment.mutate({ id: overlay.voidPaymentId, reason })
        }}
        onClose={close}
      />
      <PaymentDialog open={overlay === 'pay'} purchase={purchase} onClose={close} />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
}
