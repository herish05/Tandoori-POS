import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Plus } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { CashEntryDialog } from '@/modules/expenses/CashEntryDialog'
import { CASH_KEYS, formatDay, toDateInput, useRefreshExpenses } from '@/modules/expenses/hooks'
import { ReasonDialog } from '@/modules/purchasing/ReasonDialog'
import { cashService } from '@/services/expenses.service'
import { usePermission } from '@/stores/auth.store'
import { CASH_BOOK_SOURCE_LABELS, type CashBookRow } from '@shared/cash'

/** The id of a drawer entry, from the key of its cash book row. */
const entryId = (row: CashBookRow): string => row.key.slice('ENTRY:'.length)

/** Admin: the cash drawer. What it should hold, and every movement of cash in and out. */
export function CashPage() {
  const canManage = usePermission('cash.manage')
  const refresh = useRefreshExpenses()
  const [from, setFrom] = useState(() => toDateInput(new Date()))
  const [to, setTo] = useState(() => toDateInput(new Date()))
  const [recording, setRecording] = useState(false)
  const [voiding, setVoiding] = useState<CashBookRow | null>(null)

  const rangeValid = from !== '' && to !== '' && from <= to
  const range = { from, to }
  const summary = useQuery({
    queryKey: CASH_KEYS.summary,
    queryFn: () => cashService.summary(),
    staleTime: 0
  })
  const book = useQuery({
    queryKey: CASH_KEYS.book(range),
    queryFn: () => cashService.book(range),
    enabled: rangeValid,
    staleTime: 0
  })
  const voidEntry = useMutation({
    mutationFn: cashService.voidEntry,
    onSuccess: async () => {
      await refresh()
      setVoiding(null)
    }
  })

  const balance = summary.data?.balance ?? 0

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Cash drawer</h2>
          <p className="text-sm text-muted-foreground">
            Cash taken on bills, refunded, spent and paid to suppliers, plus the entries you record
            here. Other payment methods are not part of the drawer.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setRecording(true)
            }}
          >
            <Plus /> Record entry
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="cash-summary">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Cash that should be in the drawer
          </div>
          <div
            className={`mt-1 text-xl font-bold ${balance < 0 ? 'text-destructive' : ''}`}
            data-testid="cash-balance"
          >
            {summary.data ? formatMoney(balance) : '—'}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Today in</div>
          <div className="mt-1 text-xl font-bold">
            {summary.data ? formatMoney(summary.data.todayIn) : '—'}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Today out</div>
          <div className="mt-1 text-xl font-bold">
            {summary.data ? formatMoney(summary.data.todayOut) : '—'}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Last opening float
          </div>
          <div className="mt-1 text-sm font-medium">
            {summary.data?.lastFloatAt ? formatDateTime(summary.data.lastFloatAt) : 'Never set'}
          </div>
        </div>
      </div>
      {summary.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(summary.error)}
        </p>
      )}
      {summary.isSuccess && balance < 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            More cash has gone out than came in. Record the opening float or any cash added to the
            drawer so the balance is right.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
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
      </div>
      {!rangeValid && (
        <p role="alert" className="text-sm font-medium text-destructive">
          Choose a start date that is on or before the end date.
        </p>
      )}

      {rangeValid && book.isPending && <Skeleton className="h-64 w-full" />}
      {book.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(book.error)}
        </p>
      )}
      {rangeValid && book.isSuccess && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm" data-testid="cash-book">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Details</th>
                <th className="px-3 py-2 text-right">In</th>
                <th className="px-3 py-2 text-right">Out</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr className="bg-secondary/30 font-medium">
                <td className="px-3 py-2" colSpan={3}>
                  Opening balance, {formatDay(book.data.from)}
                </td>
                <td className="px-3 py-2 text-right" colSpan={2}>
                  {formatMoney(book.data.openingBalance)}
                </td>
                <td />
              </tr>
              {book.data.rows.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
                    No cash moved in this period.
                  </td>
                </tr>
              )}
              {book.data.rows.map((row) => (
                <tr key={row.key} className="hover:bg-accent/50">
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(row.at)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={row.direction === 'IN' ? 'success' : 'warning'}>
                      {CASH_BOOK_SOURCE_LABELS[row.source]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div>{row.description}</div>
                    {row.reference && (
                      <div className="text-xs text-muted-foreground">{row.reference}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.direction === 'IN' ? formatMoney(row.amount) : ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.direction === 'OUT' ? formatMoney(row.amount) : ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage && row.source === 'ENTRY' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          voidEntry.reset()
                          setVoiding(row)
                        }}
                      >
                        Void
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-secondary/30 font-medium">
                <td className="px-3 py-2" colSpan={3}>
                  Total for the period
                </td>
                <td className="px-3 py-2 text-right">{formatMoney(book.data.totalIn)}</td>
                <td className="px-3 py-2 text-right">{formatMoney(book.data.totalOut)}</td>
                <td />
              </tr>
              <tr className="bg-secondary/30 font-bold">
                <td className="px-3 py-2" colSpan={3}>
                  Closing balance, {formatDay(book.data.to)}
                </td>
                <td
                  className={`px-3 py-2 text-right ${book.data.closingBalance < 0 ? 'text-destructive' : ''}`}
                  colSpan={2}
                >
                  {formatMoney(book.data.closingBalance)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <CashEntryDialog
        open={recording}
        onClose={() => {
          setRecording(false)
        }}
      />
      <ReasonDialog
        open={voiding !== null}
        title="Void drawer entry"
        description={`${voiding?.description ?? 'This entry'} stays on record but no longer counts in the drawer.`}
        confirmLabel="Void entry"
        pending={voidEntry.isPending}
        error={voidEntry.isError ? toUserMessage(voidEntry.error) : undefined}
        onConfirm={(reason) => {
          if (voiding) voidEntry.mutate({ id: entryId(voiding), reason })
        }}
        onClose={() => {
          setVoiding(null)
        }}
      />
    </div>
  )
}
