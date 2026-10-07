import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import {
  createReservationInputSchema,
  DEFAULT_RESERVATION_MINUTES,
  seatReservationInputSchema,
  updateReservationInputSchema,
  type Reservation
} from '@shared/reservations'
import type { CustomerLookupResult } from '@shared/customers'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { CustomerSuggestions } from '@/modules/customers/CustomerSuggestions'
import { TABLE_KEYS } from '@/modules/tables/hooks'
import { reservationService } from '@/services/reservations.service'
import { tableService } from '@/services/tables.service'
import { toLocalInput, useRefreshReservations } from './hooks'

const DURATIONS = [30, 60, 90, 120, 150, 180, 240] as const

/** Tables a booking can be placed at (those in service); empty when the user may not list tables. */
function useBookableTables() {
  return useQuery({
    queryKey: TABLE_KEYS.list,
    queryFn: tableService.list,
    staleTime: 10_000
  })
}

/** The next half hour, a sensible default for a new booking. */
function nextHalfHour(): Date {
  const at = new Date(Date.now() + 30 * 60_000)
  at.setMinutes(at.getMinutes() < 30 ? 0 : 30, 0, 0)
  if (at.getTime() < Date.now()) at.setMinutes(at.getMinutes() + 30)
  return at
}

interface ReservationFormDialogProps {
  open: boolean
  /** The booking being edited; null makes a new one. */
  reservation: Reservation | null
  /** The day a new booking starts on (its time defaults to the next half hour, or 7 pm). */
  day: Date
  onClose: () => void
}

/** Create or change a booking. */
export function ReservationFormDialog({
  open,
  reservation,
  day,
  onClose
}: ReservationFormDialogProps) {
  return (
    <Dialog
      open={open}
      title={reservation ? 'Edit reservation' : 'New reservation'}
      onClose={onClose}
    >
      <ReservationForm
        key={reservation?.id ?? 'new'}
        reservation={reservation}
        day={day}
        onClose={onClose}
      />
    </Dialog>
  )
}

function defaultStart(day: Date): Date {
  const today = new Date()
  const sameDay =
    day.getFullYear() === today.getFullYear() &&
    day.getMonth() === today.getMonth() &&
    day.getDate() === today.getDate()
  if (sameDay) return nextHalfHour()
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 19, 0)
}

function ReservationForm({ reservation, day, onClose }: Omit<ReservationFormDialogProps, 'open'>) {
  const refresh = useRefreshReservations()
  const tables = useBookableTables()
  const [values, setValues] = useState({
    guestName: reservation?.guestName ?? '',
    guestPhone: reservation?.guestPhone ?? '',
    partySize: reservation ? String(reservation.partySize) : '2',
    reservedFor: toLocalInput(reservation ? new Date(reservation.reservedFor) : defaultStart(day)),
    durationMinutes: String(reservation?.durationMinutes ?? DEFAULT_RESERVATION_MINUTES),
    tableId: reservation?.tableId ?? '',
    notes: reservation?.notes ?? ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const done = async (): Promise<void> => {
    await refresh()
    onClose()
  }
  const create = useMutation({ mutationFn: reservationService.create, onSuccess: done })
  const update = useMutation({ mutationFn: reservationService.update, onSuccess: done })
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  const set = (patch: Partial<typeof values>): void => {
    setValues((current) => ({ ...current, ...patch }))
  }
  const text =
    (key: keyof typeof values) =>
    (event: { target: { value: string } }): void => {
      set({ [key]: event.target.value })
    }

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const at = new Date(values.reservedFor)
    const draft = {
      guestName: values.guestName,
      guestPhone: values.guestPhone,
      partySize: values.partySize.trim() === '' ? undefined : Number(values.partySize),
      reservedFor: Number.isNaN(at.getTime()) ? '' : at.toISOString(),
      durationMinutes: Number(values.durationMinutes),
      tableId: values.tableId === '' ? null : values.tableId,
      notes: values.notes
    }
    if (reservation) {
      const parsed = updateReservationInputSchema.safeParse({ id: reservation.id, ...draft })
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error))
        return
      }
      setErrors({})
      update.mutate(parsed.data)
      return
    }
    const parsed = createReservationInputSchema.safeParse(draft)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    create.mutate(parsed.data)
  }

  const pickCustomer = (customer: CustomerLookupResult): void => {
    set({ guestName: customer.name, guestPhone: customer.phone })
  }
  const bookable = (tables.data ?? []).filter((table) => table.isActive)

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Guest name" required error={errors.guestName}>
            {(c) => (
              <Input {...c} autoFocus value={values.guestName} onChange={text('guestName')} />
            )}
          </Field>
          <Field label="Phone" required error={errors.guestPhone}>
            {(c) => (
              <Input {...c} type="tel" value={values.guestPhone} onChange={text('guestPhone')} />
            )}
          </Field>
        </div>
        <CustomerSuggestions
          query={values.guestPhone.trim() === '' ? values.guestName : values.guestPhone}
          onPick={pickCustomer}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date and time" required error={errors.reservedFor}>
          {(c) => (
            <Input
              {...c}
              type="datetime-local"
              value={values.reservedFor}
              onChange={text('reservedFor')}
            />
          )}
        </Field>
        <Field label="Guests" required error={errors.partySize}>
          {(c) => (
            <Input
              {...c}
              inputMode="numeric"
              value={values.partySize}
              onChange={text('partySize')}
            />
          )}
        </Field>
        <Field label="Table" hint="Optional. Choose when the guests arrive if unsure.">
          {(c) => (
            <Select {...c} value={values.tableId} onChange={text('tableId')}>
              <option value="">No table yet</option>
              {bookable.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.displayName} · {table.areaName} · seats {table.capacity}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Stays about" error={errors.durationMinutes}>
          {(c) => (
            <Select {...c} value={values.durationMinutes} onChange={text('durationMinutes')}>
              {DURATIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes % 60 === 0
                    ? `${String(minutes / 60)} hr`
                    : `${String(Math.floor(minutes / 60))} hr ${String(minutes % 60)} min`.replace(
                        /^0 hr /,
                        ''
                      )}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Notes" error={errors.notes} hint="Occasion, seating preference, allergies.">
        {(c) => <Textarea {...c} rows={2} value={values.notes} onChange={text('notes')} />}
      </Field>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {reservation ? 'Save changes' : 'Book table'}
        </Button>
      </div>
    </form>
  )
}

interface SeatDialogProps {
  /** The booking whose guests have arrived; null keeps the dialog closed. */
  reservation: Reservation | null
  onClose: () => void
}

/** Seats the guests: opens the table and closes the booking. Asks for a table if none is set. */
export function SeatReservationDialog({ reservation, onClose }: SeatDialogProps) {
  return (
    <Dialog open={reservation !== null} title="Seat guests" onClose={onClose}>
      {reservation && <SeatForm key={reservation.id} reservation={reservation} onClose={onClose} />}
    </Dialog>
  )
}

function SeatForm({ reservation, onClose }: { reservation: Reservation; onClose: () => void }) {
  const refresh = useRefreshReservations()
  const tables = useBookableTables()
  const [tableId, setTableId] = useState(reservation.tableId ?? '')
  const [error, setError] = useState<string | undefined>()

  const seat = useMutation({
    mutationFn: reservationService.seat,
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: () => {
      void refresh()
    }
  })

  const choices = (tables.data ?? []).filter(
    (table) =>
      table.isActive &&
      table.capacity >= reservation.partySize &&
      (table.id === reservation.tableId ||
        table.status === 'AVAILABLE' ||
        table.status === 'RESERVED')
  )

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    const parsed = seatReservationInputSchema.safeParse({
      id: reservation.id,
      tableId: tableId === '' ? null : tableId
    })
    if (!parsed.success || (parsed.data.tableId === null && reservation.tableId === null)) {
      setError('Choose a table for the guests.')
      return
    }
    setError(undefined)
    seat.mutate(parsed.data)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {reservation.guestName}, {reservation.partySize} guests. The table is opened for them and
        the booking is marked seated.
      </p>
      <Field label="Table" required error={error}>
        {(c) => (
          <Select
            {...c}
            value={tableId}
            onChange={(event) => {
              setTableId(event.target.value)
            }}
          >
            <option value="">Choose a table</option>
            {choices.map((table) => (
              <option key={table.id} value={table.id}>
                {table.displayName} · {table.areaName} · seats {table.capacity}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {seat.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(seat.error)}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={seat.isPending}>
          {seat.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Seat guests
        </Button>
      </div>
    </form>
  )
}
