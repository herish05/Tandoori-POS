import { useQueryClient } from '@tanstack/react-query'

/** Query keys for reservations. Every mutation refreshes `reservations`, `tables` and `customers`. */
export const RESERVATION_KEYS = {
  list: (filter: unknown) => ['reservations', 'list', filter]
} as const

/** How often reservation screens re-read the server so every terminal stays current. */
export const RESERVATION_REFRESH_MS = 10_000

/** Returns a function that refreshes everything a reservation change can touch. */
export function useRefreshReservations(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['reservations'] }),
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    ])
  }
}

/** An ISO time as the "YYYY-MM-DDTHH:mm" a datetime-local field wants, in local time. */
export function toLocalInput(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Local midnight of the day containing `date`. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Just the time of an ISO timestamp, e.g. "7:30 pm". */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(iso))
}
