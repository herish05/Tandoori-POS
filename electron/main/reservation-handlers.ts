import { IPC_CHANNELS } from '@shared/ipc-channels'
import { idInputSchema } from '@shared/auth-schemas'
import {
  cancelReservationInputSchema,
  createReservationInputSchema,
  reservationFilterSchema,
  seatReservationInputSchema,
  updateReservationInputSchema
} from '@shared/reservations'
import type { IpcRegistrar } from './ipc/registrar'
import type { Services } from './services'

const VIEW = { permissions: ['reservations.view'] } as const
const OPERATE = { permissions: ['reservations.operate'] } as const
// Seating guests opens their table, so it needs the right to open tables too.
const SEAT = { permissions: ['reservations.operate', 'tables.operate'] } as const

/** Reservation handlers: bookings, cancelling, no-shows and seating guests. */
export function registerReservationHandlers(registrar: IpcRegistrar, services: Services): void {
  const { reservations } = services

  registrar.handleProtected(IPC_CHANNELS.reservationsList, reservationFilterSchema, VIEW, (input) =>
    reservations.list(input)
  )
  registrar.handleProtected(IPC_CHANNELS.reservationsGet, idInputSchema, VIEW, (input) =>
    reservations.get(input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.reservationsCreate,
    createReservationInputSchema,
    OPERATE,
    (input, ctx) => reservations.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.reservationsUpdate,
    updateReservationInputSchema,
    OPERATE,
    (input, ctx) => reservations.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.reservationsCancel,
    cancelReservationInputSchema,
    OPERATE,
    (input, ctx) => reservations.cancel(ctx, input)
  )
  registrar.handleProtected(IPC_CHANNELS.reservationsNoShow, idInputSchema, OPERATE, (input, ctx) =>
    reservations.noShow(ctx, input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.reservationsSeat,
    seatReservationInputSchema,
    SEAT,
    (input, ctx) => reservations.seat(ctx, input)
  )
}
