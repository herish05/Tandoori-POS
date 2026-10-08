import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import {
  PURCHASE_STATUSES,
  PURCHASE_STATUS_LABELS,
  type Purchase,
  type PurchaseFilterInput,
  type PurchaseStatus
} from '@shared/purchasing'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { useDebouncedValue } from '@/modules/menu/hooks'
import { PURCHASING_KEYS, formatPurchaseDate } from '@/modules/purchasing/hooks'
import { PurchaseDetailDialog } from '@/modules/purchasing/PurchaseDetailDialog'
import { paymentStatusBadge, purchaseStatusBadge } from '@/modules/purchasing/badges'
import { PurchaseFormDialog } from '@/modules/purchasing/PurchaseFormDialog'
import { purchaseService, supplierService } from '@/services/purchasing.service'
import { usePermission } from '@/stores/auth.store'

/** Admin: what was bought from whom, what has been received and what is still owed. */
export function PurchasesPage() {
  const canOperate = usePermission('purchases.operate')
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim())
  const [status, setStatus] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [unpaidOnly, setUnpaidOnly] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [form, setForm] = useState<'closed' | 'new' | Purchase>('closed')

  const filter: PurchaseFilterInput = {
    ...(debounced ? { search: debounced } : {}),
    ...(status ? { status: status as PurchaseStatus } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(unpaidOnly ? { unpaidOnly: true } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {})
  }
  const summary = useQuery({
    queryKey: PURCHASING_KEYS.summary,
    queryFn: purchaseService.summary,
    staleTime: 0
  })
  const suppliers = useQuery({
    queryKey: PURCHASING_KEYS.suppliers({ includeInactive: true }),
    queryFn: () => supplierService.list({ includeInactive: true }),
    staleTime: 0
  })
  const purchases = useQuery({
    queryKey: PURCHASING_KEYS.list(filter),
    queryFn: () => purchaseService.list(filter),
    staleTime: 0
  })

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Purchases</h2>
          <p className="text-sm text-muted-foreground">
            Record what you buy from suppliers. Receiving a purchase adds the goods to stock.
          </p>
        </div>
        {canOperate && (
          <Button
            onClick={() => {
              setForm('new')
            }}
          >
            <Plus /> New purchase
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="purchasing-summary">
        <SummaryCard label="Drafts" value={summary.data ? String(summary.data.draftCount) : '—'} />
        <SummaryCard
          label="Unpaid purchases"
          value={summary.data ? String(summary.data.unpaidCount) : '—'}
        />
        <SummaryCard
          label="Owed to suppliers"
          value={summary.data ? formatMoney(summary.data.totalDue) : '—'}
        />
        <SummaryCard
          label="Bought this month"
          value={summary.data ? formatMoney(summary.data.purchasedThisMonth) : '—'}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1 text-xs font-medium">
          Search
          <Input
            className="w-56"
            placeholder="Number, invoice or supplier"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </label>
        <label className="block space-y-1 text-xs font-medium">
          Status
          <Select
            className="w-36"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
            }}
          >
            <option value="">All</option>
            {PURCHASE_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {PURCHASE_STATUS_LABELS[entry]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-xs font-medium">
          Supplier
          <Select
            className="w-44"
            value={supplierId}
            onChange={(event) => {
              setSupplierId(event.target.value)
            }}
          >
            <option value="">All suppliers</option>
            {(suppliers.data ?? []).map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-xs font-medium">
          From
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value)
            }}
          />
        </label>
        <label className="block space-y-1 text-xs font-medium">
          To
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value)
            }}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={unpaidOnly}
            onChange={(event) => {
              setUnpaidOnly(event.target.checked)
            }}
          />
          Unpaid only
        </label>
      </div>

      {purchases.isPending && <Skeleton className="h-64 w-full" />}
      {purchases.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(purchases.error)}
        </p>
      )}
      {purchases.isSuccess && purchases.data.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {Object.keys(filter).length > 0
            ? 'No purchase matches.'
            : 'No purchases yet. Start one when goods arrive from a supplier.'}
        </div>
      )}
      {purchases.isSuccess && purchases.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm" data-testid="purchases-table">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Purchase</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Items</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Due</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {purchases.data.map((purchase) => (
                <tr
                  key={purchase.id}
                  tabIndex={0}
                  className="cursor-pointer hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                  onClick={() => {
                    setDetailId(purchase.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setDetailId(purchase.id)
                  }}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{purchase.purchaseNumber}</div>
                    {purchase.invoiceNumber && (
                      <div className="text-xs text-muted-foreground">
                        Invoice {purchase.invoiceNumber}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">{purchase.supplierName}</td>
                  <td className="px-3 py-2">{formatPurchaseDate(purchase.purchaseDate)}</td>
                  <td className="px-3 py-2 text-right">{purchase.lineCount}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(purchase.total)}</td>
                  <td className="px-3 py-2 text-right">
                    {purchase.amountDue > 0 ? formatMoney(purchase.amountDue) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {purchaseStatusBadge(purchase)}
                      {paymentStatusBadge(purchase)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PurchaseDetailDialog
        purchaseId={detailId}
        onClose={() => {
          setDetailId(null)
        }}
        onEdit={(purchase) => {
          setDetailId(null)
          setForm(purchase)
        }}
      />
      <PurchaseFormDialog
        open={form !== 'closed'}
        purchase={form === 'closed' || form === 'new' ? null : form}
        onClose={() => {
          setForm('closed')
        }}
        onSaved={(saved) => {
          setForm('closed')
          setDetailId(saved.id)
        }}
      />
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  )
}
