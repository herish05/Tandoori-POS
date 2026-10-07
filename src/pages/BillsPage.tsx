import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BILL_STATUS_LABELS, BILL_STATUSES, type BillStatus } from '@shared/billing'
import { ORDER_TYPE_LABELS } from '@shared/orders'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { BILL_STATUS_TONE } from '@/modules/billing/bill-status'
import { BILL_KEYS, BILL_REFRESH_MS } from '@/modules/billing/hooks'
import { useDebouncedValue } from '@/modules/menu/hooks'
import { billService } from '@/services/billing.service'

/** Admin: every bill, newest first, with its status and what is still owed. */
export function BillsPage() {
  const [status, setStatus] = useState<BillStatus | ''>('')
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim())

  const filter = {
    ...(status ? { statuses: [status] } : {}),
    ...(debounced ? { search: debounced } : {}),
    limit: 200
  }
  const bills = useQuery({
    queryKey: BILL_KEYS.list(filter),
    queryFn: () => billService.list(filter),
    staleTime: 0,
    refetchInterval: BILL_REFRESH_MS * 2
  })

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h2 className="text-xl font-bold">Bills</h2>
        <p className="text-sm text-muted-foreground">
          Every bill that was generated. Amounts are calculated by the system from the order, the
          discounts and the billing settings.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-xs font-medium">
          Search
          <Input
            className="w-56"
            placeholder="Bill or order number"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          Status
          <Select
            className="w-44"
            value={status}
            onChange={(event) => {
              setStatus(BILL_STATUSES.find((entry) => entry === event.target.value) ?? '')
            }}
          >
            <option value="">All</option>
            {BILL_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {BILL_STATUS_LABELS[entry]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {bills.isPending && <Skeleton className="h-64 w-full" />}
      {bills.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(bills.error)}
        </p>
      )}
      {bills.isSuccess && bills.data.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {debounced || status
            ? 'No bill matches these filters.'
            : 'No bill has been generated yet. Bills are made from a served order.'}
        </div>
      )}
      {bills.isSuccess && bills.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm" data-testid="bills-table">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Bill</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {bills.data.map((bill) => (
                <tr key={bill.id}>
                  <td className="px-3 py-2 font-medium">{bill.billNumber}</td>
                  <td className="px-3 py-2">
                    {bill.orderNumber}
                    <span className="block text-xs text-muted-foreground">
                      {ORDER_TYPE_LABELS[bill.orderType]}
                      {bill.tableNumber ? ` · Table ${bill.tableNumber}` : ''}
                      {bill.customerName ? ` · ${bill.customerName}` : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatDateTime(bill.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatMoney(bill.grandTotal)}
                    {bill.refundedTotal > 0 && (
                      <span className="block text-xs font-normal text-destructive">
                        Refunded {formatMoney(bill.refundedTotal)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{formatMoney(bill.balance)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={BILL_STATUS_TONE[bill.status]}>
                      {BILL_STATUS_LABELS[bill.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/admin/bills/${bill.id}`}>
                        <Eye /> Open
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
