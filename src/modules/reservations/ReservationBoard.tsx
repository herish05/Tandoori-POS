import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarPlus, ChevronLeft, ChevronRight, Pencil, Phone, Users } from 'lucide-react'
import { useState } from 'react'
import {
  RESERVATION_STATUS_LABELS,
  type Reservation,
  type ReservationStatus
} from '@shared/reservations'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { ReasonDialog } from '@/modules/orders/ReasonDialog'
import { useNow } from '@/modules/tables/hooks'
import { reservationService } from '@/services/reservations.service'
import { usePermission } from '@/stores/auth.store'
import { ReservationFormDialog, SeatReservationDialog } from './ReservationDialogs'
import {
  formatTime,
  RESERVATION_KEYS,
  RESERVATION_REFRESH_MS,
  startOfDay,
  toLocalInput,
  useRefreshReservations
} from './hooks'

const STATUS_TONE: Record<ReservationStatus, 'default' | 'success' | 'destructive' | 'warning'> = {
  BOOKED: 'default',
  SEATED: 'success',
  CANCELLED: 'destructive',
  NO_SHOW: 'warning'
}

const DAY_MS = 24 * 60 * 60 * 1000

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function dayTitle(day: Date, today: Date): string {
  const label = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(day)
  const diff = Math.round((day.getTime() - today.getTime()) / DAY_MS)
  if (diff === 0) return `Today, ${label}`
  if (diff === 1) return `Tomorrow, ${label}`
  if (diff === -1) return `Yesterday, ${label}`
  return label
}

/**
 * The bookings of one day, with everything done to them: make, change, seat, cancel, no-show.
 * Used by the admin Reservations page and by the POS Reservations tab.
 */
export function ReservationBoard() {
  const canOperate = usePermission('reservations.operate')
  const canSeat = usePermission('tables.operate')
  const refresh = useRefreshReservations()
  const now = useNow()
  const [day, setDay] = useState(() => startOfDay(new Date()))
  const [showClosed, setShowClosed] = useState(true)
  const [form, setForm] = useState<'closed' | 'new' | Reservation>('closed')
  const [seating, setSeating] = useState<Reservation | null>(null)
  const [cancelling, setCancelling] = useState<Reservation | null>(null)

  const today = startOfDay(new Date(now))
  const filter = { from: day.toISOString(), to: addDays(day, 1).toISOString(), limit: 300 }
  const bookings = useQuery({
    queryKey: RESERVATION_KEYS.list(filter),
    queryFn: () => reservationService.list(filter),
    staleTime: 0,
    refetchInterval: RESERVATION_REFRESH_MS
  })

  const cancel = useMutation({
    mutationFn: reservationService.cancel,
    onSuccess: async () => {
      await refresh()
      setCancelling(null)
    }
  })
  const noShow = useMutation({
    mutationFn: reservationService.noShow,
    onSuccess: refresh,
    onError: () => {
      void refresh()
    }
  })

  const visible = (bookings.data ?? []).filter((entry) => showClosed || entry.status === 'BOOKED')
  const waiting = (bookings.data ?? []).filter((entry) => entry.status === 'BOOKED').length

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Reservations</h2>
          <p className="text-sm text-muted-foreground">
            {dayTitle(day, today)}
            {bookings.isSuccess && ` · ${String(waiting)} waiting`}
          </p>
        </div>
        {canOperate && (
          <Button
            onClick={() => {
              setForm('new')
            }}
          >
            <CalendarPlus /> New reservation
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous day"
          onClick={() => {
            setDay(addDays(day, -1))
          }}
        >
          <ChevronLeft />
        </Button>
        <Input
          type="date"
          aria-label="Day"
          className="w-44"
          value={toLocalInput(day).slice(0, 10)}
          onChange={(event) => {
            const [year, month, date] = event.target.value.split('-').map(Number)
            if (year && month && date) setDay(new Date(year, month - 1, date))
          }}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="Next day"
          onClick={() => {
            setDay(addDays(day, 1))
          }}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDay(today)
          }}
        >
          Today
        </Button>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[hsl(var(--primary))]"
            checked={showClosed}
            onChange={(event) => {
              setShowClosed(event.target.checked)
            }}
          />
          Show seated and cancelled
        </label>
      </div>

      {bookings.isPending && <Skeleton className="h-48 w-full" />}
      {bookings.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(bookings.error)}
        </p>
      )}
      {bookings.isSuccess && visible.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No reservations for this day.
        </div>
      )}
      {noShow.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(noShow.error)}
        </p>
      )}

      <ul className="space-y-2" data-testid="reservation-list">
        {visible.map((entry) => {
          const booked = entry.status === 'BOOKED'
          const due = new Date(entry.reservedFor).getTime() <= now
          return (
            <li
              key={entry.id}
              className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-3"
            >
              <div className="w-20 shrink-0 text-center">
                <p className="text-lg font-bold">{formatTime(entry.reservedFor)}</p>
                <p className="text-xs text-muted-foreground">{entry.durationMinutes} min</p>
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {entry.guestName}
                  <Badge variant={STATUS_TONE[entry.status]}>
                    {RESERVATION_STATUS_LABELS[entry.status]}
                  </Badge>
                  {booked && due && <Badge variant="warning">Late</Badge>}
                </p>
                <p className="flex flex-wrap items-center gap-x-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" aria-hidden /> {entry.partySize}
                  </span>
                  <span className="flex items-center gap-1">
                    <Phone className="size-3.5" aria-hidden /> {entry.guestPhone}
                  </span>
                  <span>
                    {entry.tableNumber
                      ? `${entry.tableName ?? entry.tableNumber}${entry.areaName ? ` · ${entry.areaName}` : ''}`
                      : 'No table yet'}
                  </span>
                </p>
                {entry.notes && <p className="text-sm">{entry.notes}</p>}
                {entry.cancelReason && (
                  <p className="text-xs text-muted-foreground">Reason: {entry.cancelReason}</p>
                )}
              </div>
              {booked && canOperate && (
                <div className="flex flex-wrap gap-2">
                  {canSeat && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setSeating(entry)
                      }}
                    >
                      Seat
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Edit reservation for ${entry.guestName}`}
                    onClick={() => {
                      setForm(entry)
                    }}
                  >
                    <Pencil /> Edit
                  </Button>
                  {due && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={noShow.isPending}
                      onClick={() => {
                        noShow.mutate(entry.id)
                      }}
                    >
                      No-show
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCancelling(entry)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <ReservationFormDialog
        open={form !== 'closed'}
        reservation={form === 'closed' || form === 'new' ? null : form}
        day={day}
        onClose={() => {
          setForm('closed')
        }}
      />
      <SeatReservationDialog
        reservation={seating}
        onClose={() => {
          setSeating(null)
        }}
      />
      <ReasonDialog
        open={cancelling !== null}
        title="Cancel reservation"
        message={
          cancelling
            ? `${cancelling.guestName}, ${String(cancelling.partySize)} guests at ${formatTime(cancelling.reservedFor)}. The table becomes free for others.`
            : ''
        }
        confirmLabel="Cancel reservation"
        required={false}
        pending={cancel.isPending}
        error={cancel.isError ? toUserMessage(cancel.error) : undefined}
        onConfirm={(reason) => {
          if (cancelling) cancel.mutate({ id: cancelling.id, reason })
        }}
        onClose={() => {
          setCancelling(null)
          cancel.reset()
        }}
      />
    </div>
  )
}
