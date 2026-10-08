import { useQueryClient } from '@tanstack/react-query'

/**
 * Query keys for suppliers and purchases. Receiving a purchase also changes stock, so every
 * mutation refreshes both the `purchasing` and `inventory` families.
 */
export const PURCHASING_KEYS = {
  suppliers: (filter: unknown) => ['purchasing', 'suppliers', filter],
  summary: ['purchasing', 'summary'],
  list: (filter: unknown) => ['purchasing', 'list', filter],
  detail: (id: string) => ['purchasing', 'detail', id]
} as const

/** Returns a function that refreshes everything that shows suppliers, purchases or stock. */
export function useRefreshPurchasing(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['purchasing'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
    ])
  }
}

/** `2026-01-05` → `05 Jan 2026`. */
export function formatPurchaseDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date)
}

/** Today's date in the restaurant's time zone as `YYYY-MM-DD`, for new purchases. */
export function todayInput(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}
