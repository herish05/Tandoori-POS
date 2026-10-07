import { z } from 'zod'
import { MAX_TABLE_CAPACITY } from './tables'
import { normalizePhone, MAX_PHONE_DIGITS, MIN_PHONE_DIGITS } from './customers'

/**
 * Table reservations. A booking holds a guest, a party size, a time and (optionally) a table.
 * When the guests arrive the booking is "seated": the table is opened and the booking is done.
 * A reservation that was never honoured ends as CANCELLED or NO_SHOW and is never reopened.
 */

export const RESERVATION_STATUSES = ['BOOKED', 'SEATED', 'CANCELLED', 'NO_SHOW'] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  BOOKED: 'Booked',
  SEATED: 'Seated',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show'
}

export const DEFAULT_RESERVATION_MINUTES = 90
export const MIN_RESERVATION_MINUTES = 30
export const MAX_RESERVATION_MINUTES = 360

/** A free table shows as reserved on the floor from this long before the booking starts. */
export const RESERVED_LEAD_MS = 60 * 60 * 1000
/** A booking may be made for a time this far in the past (clock drift, typing). */
export const RESERVE_PAST_GRACE_MS = 5 * 60 * 1000
/** Bookings further ahead than this are refused (almost certainly a typo). */
export const MAX_RESERVE_AHEAD_MS = 120 * 24 * 60 * 60 * 1000

// --- Response shapes -----------------------------------------------------------------------

export interface Reservation {
  id: string
  customerId: string | null
  guestName: string
  guestPhone: string
  partySize: number
  /** ISO time the guests are expected. */
  reservedFor: string
  durationMinutes: number
  /** ISO time the booking's slot ends. */
  endsAt: string
  tableId: string | null
  tableNumber: string | null
  tableName: string | null
  areaName: string | null
  status: ReservationStatus
  notes: string | null
  seatedAt: string | null
  cancelReason: string | null
  cancelledAt: string | null
  createdByName: string
  createdAt: string
}

// --- Validation ----------------------------------------------------------------------------

const idSchema = z.uuid()

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${String(max)} characters.`)
    .nullish()
    .transform((value) => (value === null || value === undefined || value === '' ? null : value))

const reservationFields = {
  guestName: z
    .string('Enter the guest name.')
    .trim()
    .min(1, 'Enter the guest name.')
    .max(80, 'The name must be at most 80 characters.'),
  guestPhone: z
    .string('Enter a phone number.')
    .trim()
    .regex(/^\+?[0-9][0-9\s-]{3,20}$/, 'Enter a valid phone number.')
    .transform(normalizePhone)
    .refine(
      (digits) => digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS,
      'Enter a valid phone number.'
    ),
  partySize: z
    .number('Enter how many guests are coming.')
    .int('Guests must be a whole number.')
    .min(1, 'At least 1 guest is needed.')
    .max(MAX_TABLE_CAPACITY, `At most ${String(MAX_TABLE_CAPACITY)} guests.`),
  reservedFor: z.iso.datetime({ offset: true, message: 'Enter a valid date and time.' }),
  durationMinutes: z
    .number()
    .int('Duration must be a whole number of minutes.')
    .min(
      MIN_RESERVATION_MINUTES,
      `A booking lasts at least ${String(MIN_RESERVATION_MINUTES)} minutes.`
    )
    .max(
      MAX_RESERVATION_MINUTES,
      `A booking lasts at most ${String(MAX_RESERVATION_MINUTES)} minutes.`
    )
    .default(DEFAULT_RESERVATION_MINUTES),
  tableId: idSchema.nullish().transform((value) => value ?? null),
  notes: optionalText('Notes', 300)
}

export const createReservationInputSchema = z.object(reservationFields)
export const updateReservationInputSchema = z.object({ id: idSchema, ...reservationFields })

export const cancelReservationInputSchema = z.object({
  id: idSchema,
  reason: optionalText('Reason', 200)
})

/** Seats the guests; `tableId` is needed when the booking has no table yet (or to change it). */
export const seatReservationInputSchema = z.object({
  id: idSchema,
  tableId: idSchema.nullish().transform((value) => value ?? null)
})

export const reservationFilterSchema = z.object({
  /** ISO times: bookings whose time is from `from` (inclusive) up to `to` (exclusive). */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  statuses: z.array(z.enum(RESERVATION_STATUSES)).max(RESERVATION_STATUSES.length).optional(),
  tableId: idSchema.optional(),
  /** Matches the guest name or phone. */
  search: z.string().trim().max(60).optional(),
  limit: z.number().int().min(1).max(500).optional()
})

export type CreateReservationInput = z.input<typeof createReservationInputSchema>
export type UpdateReservationInput = z.input<typeof updateReservationInputSchema>
export type CancelReservationInput = z.input<typeof cancelReservationInputSchema>
export type SeatReservationInput = z.input<typeof seatReservationInputSchema>
export type ReservationFilterInput = z.input<typeof reservationFilterSchema>

export type CreateReservationData = z.output<typeof createReservationInputSchema>
export type UpdateReservationData = z.output<typeof updateReservationInputSchema>
export type CancelReservationData = z.output<typeof cancelReservationInputSchema>
export type SeatReservationData = z.output<typeof seatReservationInputSchema>
export type ReservationFilterData = z.output<typeof reservationFilterSchema>
