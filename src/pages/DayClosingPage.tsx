import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Lock, LockOpen } from 'lucide-react'
import { useState } from 'react'
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@shared/billing'
import type { DaySummary, MethodTotal } from '@shared/day-closing'
import { ORDER_TYPE_LABELS } from '@shared/orders'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { CloseDayDialog } from '@/modules/day-closing/CloseDayDialog'
import { DAY_KEYS, useRefreshDay } from '@/modules/day-closing/hooks'
import { formatDay } from '@/modules/expenses/hooks'
import { ReasonDialog } from '@/modules/purchasing/ReasonDialog'
import { dayClosingService } from '@/services/day-closing.service'
import { usePermission } from '@/stores/auth.store'

const methodLabel = (method: string): string =>
  method in PAYMENT_METHOD_LABELS ? PAYMENT_METHOD_LABELS[method as PaymentMethod] : method

function Card({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold ${tone === 'bad' ? 'text-destructive' : ''}`}>
        {value}
      </div>
    </div>
  )
}

function MethodList({ title, rows }: { title: string; rows: MethodTotal[] }) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-sm font-bold">{formatMoney(total)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.method} className="flex justify-between">
              <span>
                {methodLabel(row.method)}{' '}
                <span className="text-muted-foreground">({String(row.count)})</span>
              </span>
              <span>{formatMoney(row.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SummaryView({ summary }: { summary: DaySummary }) {
  const { sales, cash } = summary
  return (
    <div className="space-y-3" data-testid="day-summary">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Bills settled" value={String(sales.bills)} />
        <Card label="Sales" value={formatMoney(sales.total)} />
        <Card label="Discounts" value={formatMoney(sales.discounts)} />
        <Card label="Tax" value={formatMoney(sales.tax)} />
      </div>
      {summary.cancelledBills > 0 && (
        <p className="text-sm text-muted-foreground">
          {String(summary.cancelledBills)}{' '}
          {summary.cancelledBills === 1 ? 'bill was' : 'bills were'} cancelled.
        </p>
      )}
      {summary.byOrderType.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <h3 className="text-sm font-semibold">Sales by order type</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {summary.byOrderType.map((row) => (
              <li key={row.type} className="flex justify-between">
                <span>
                  {ORDER_TYPE_LABELS[row.type]}{' '}
                  <span className="text-muted-foreground">({String(row.bills)})</span>
                </span>
                <span>{formatMoney(row.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <MethodList title="Collected" rows={summary.collections} />
        <MethodList title="Refunded" rows={summary.refunds} />
        <MethodList title="Expenses" rows={summary.expenses} />
        <MethodList title="Paid to suppliers" rows={summary.supplierPayments} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Cash at start" value={formatMoney(cash.opening)} />
        <Card label="Cash in" value={formatMoney(cash.in)} />
        <Card label="Cash out" value={formatMoney(cash.out)} />
        <Card
          label="Cash the book expects"
          value={formatMoney(cash.expected)}
          {...(cash.expected < 0 ? { tone: 'bad' as const } : {})}
        />
      </div>
    </div>
  )
}

/** Admin: count the drawer and close the day, or reopen a closed one. */
export function DayClosingPage() {
  const canClose = usePermission('day.close')
  const canReopen = usePermission('day.reopen')
  const refresh = useRefreshDay()
  const [date, setDate] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)

  const overview = useQuery({
    queryKey: DAY_KEYS.overview,
    queryFn: () => dayClosingService.overview(),
    staleTime: 0
  })
  const chosen = date ?? overview.data?.today ?? ''
  const status = useQuery({
    queryKey: DAY_KEYS.status(chosen),
    queryFn: () => dayClosingService.status({ date: chosen }),
    enabled: chosen !== '',
    staleTime: 0
  })
  const history = useQuery({
    queryKey: DAY_KEYS.list({ limit: 30 }),
    queryFn: () => dayClosingService.list({ limit: 30 }),
    staleTime: 0
  })
  const reopen = useMutation({
    mutationFn: dayClosingService.reopen,
    onSuccess: async () => {
      await refresh()
      setReopening(false)
    }
  })

  const current = status.data
  const stored = current?.closing ?? null
  const latestId = history.data?.[0]?.id
  const unclosed = overview.data?.unclosedDays ?? []

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Day closing</h2>
          <p className="text-sm text-muted-foreground">
            Count the drawer at the end of the day, compare it with the book and lock the day.
            Closing needs every order settled or cancelled.
          </p>
        </div>
        <label className="block space-y-1 text-xs font-medium">
          Day
          <Input
            type="date"
            value={chosen}
            onChange={(event) => {
              setDate(event.target.value === '' ? null : event.target.value)
            }}
          />
        </label>
      </div>

      {unclosed.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
          data-testid="unclosed-days"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p>
              {unclosed.length === 1 ? 'An earlier day was' : 'Earlier days were'} never closed:
            </p>
            <div className="flex flex-wrap gap-2">
              {unclosed.map((day) => (
                <Button
                  key={day}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDate(day)
                  }}
                >
                  {formatDay(day)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {(overview.isError || status.isError) && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(overview.error ?? status.error)}
        </p>
      )}
      {status.isPending && <Skeleton className="h-64 w-full" />}

      {current && (
        <section className="space-y-3" aria-label={`Day ${current.date}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">
                {formatDay(current.date)}
                {current.isToday ? ' (today)' : ''}
              </h3>
              {stored ? (
                <Badge variant="success">
                  <Lock className="mr-1 size-3" aria-hidden /> Closed
                </Badge>
              ) : (
                <Badge variant="warning">
                  <LockOpen className="mr-1 size-3" aria-hidden /> Open
                </Badge>
              )}
            </div>
            {!stored && canClose && (
              <Button
                disabled={!current.canClose}
                onClick={() => {
                  setClosing(true)
                }}
              >
                Close day
              </Button>
            )}
            {stored && canReopen && stored.id === latestId && (
              <Button
                variant="outline"
                onClick={() => {
                  reopen.reset()
                  setReopening(true)
                }}
              >
                Reopen day
              </Button>
            )}
          </div>

          {current.blockers.length > 0 && (
            <ul
              role="alert"
              className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              data-testid="day-blockers"
            >
              {current.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}

          {stored && (
            <div className="rounded-lg border bg-card p-3 text-sm" data-testid="day-closed-card">
              <div className="font-semibold">{stored.closingNumber}</div>
              <div className="text-muted-foreground">
                Closed {formatDateTime(stored.closedAt)}
                {stored.closedBy ? ` by ${stored.closedBy}` : ''}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <Card label="Book said" value={formatMoney(stored.expectedCash)} />
                <Card label="Counted" value={formatMoney(stored.countedCash)} />
                <Card
                  label="Difference"
                  value={(stored.variance > 0 ? '+' : '') + formatMoney(stored.variance)}
                  {...(stored.variance === 0 ? {} : { tone: 'bad' as const })}
                />
              </div>
              {stored.notes && <p className="mt-2">{stored.notes}</p>}
              {stored.denominations.length > 0 && (
                <p className="mt-2 text-muted-foreground">
                  Counted:{' '}
                  {stored.denominations
                    .map((row) => `${String(row.count)} × ${formatMoney(row.value)}`)
                    .join(', ')}
                </p>
              )}
            </div>
          )}

          <SummaryView summary={current.summary} />
        </section>
      )}

      <section className="space-y-2" aria-label="Closing history">
        <h3 className="text-lg font-semibold">Recent closings</h3>
        {history.isError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {toUserMessage(history.error)}
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm" data-testid="day-history">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Day</th>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2 text-right">Sales</th>
                <th className="px-3 py-2 text-right">Counted</th>
                <th className="px-3 py-2 text-right">Difference</th>
                <th className="px-3 py-2">Closed by</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {history.data?.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
                    No day has been closed yet.
                  </td>
                </tr>
              )}
              {history.data?.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => {
                    setDate(row.date)
                  }}
                >
                  <td className="px-3 py-2">{formatDay(row.date)}</td>
                  <td className="px-3 py-2">{row.closingNumber}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.salesTotal)}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.countedCash)}</td>
                  <td
                    className={`px-3 py-2 text-right ${row.variance === 0 ? '' : 'text-destructive'}`}
                  >
                    {(row.variance > 0 ? '+' : '') + formatMoney(row.variance)}
                  </td>
                  <td className="px-3 py-2">{row.closedBy ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {current && !stored && (
        <CloseDayDialog
          open={closing}
          status={current}
          onClose={() => {
            setClosing(false)
          }}
        />
      )}
      <ReasonDialog
        open={reopening}
        title="Reopen day"
        description={`${current ? formatDay(current.date) : 'This day'} will accept records again. The count entry is voided and the closing stays on record.`}
        confirmLabel="Reopen day"
        pending={reopen.isPending}
        error={reopen.isError ? toUserMessage(reopen.error) : undefined}
        onConfirm={(reason) => {
          if (stored) reopen.mutate({ id: stored.id, reason })
        }}
        onClose={() => {
          setReopening(false)
        }}
      />
    </div>
  )
}
