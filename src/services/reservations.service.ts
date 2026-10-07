import type {
  CancelReservationInput,
  CreateReservationInput,
  Reservation,
  ReservationFilterInput,
  SeatReservationInput,
  UpdateReservationInput
} from '@shared/reservations'
import { getApi, unwrap } from '@/lib/ipc'

export const reservationService = {
  list: (filter: ReservationFilterInput = {}): Promise<Reservation[]> =>
    unwrap(getApi().reservations.list(filter)),
  get: (id: string): Promise<Reservation> => unwrap(getApi().reservations.get(id)),
  create: (input: CreateReservationInput): Promise<Reservation> =>
    unwrap(getApi().reservations.create(input)),
  update: (input: UpdateReservationInput): Promise<Reservation> =>
    unwrap(getApi().reservations.update(input)),
  cancel: (input: CancelReservationInput): Promise<Reservation> =>
    unwrap(getApi().reservations.cancel(input)),
  noShow: (id: string): Promise<Reservation> => unwrap(getApi().reservations.noShow(id)),
  seat: (input: SeatReservationInput): Promise<Reservation> =>
    unwrap(getApi().reservations.seat(input))
}
