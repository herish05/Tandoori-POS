import { useQueryClient } from '@tanstack/react-query'

/**
 * Query keys for expenses and the cash drawer. Cash expenses move the drawer, so every change
 * refreshes both the `expenses` and `cash` families.
 */
export const EXPENSE_KEYS = {
  categories: (includeInactive: boolean) => ['expenses', 'categories', includeInactive],
  list: (filter: unknown) => ['expenses', 'list', filter],
  summary: (filter: unknown) => ['expenses', 'summary', filter]
} as const

export const CASH_KEYS = {
  summary: ['cash', 'summary'],
  book: (filter: unknown) => ['cash', 'book', filter]
} as const

/** Returns a function that refreshes everything that shows expenses or the drawer. */
export function useRefreshExpenses(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['expenses'] }),
      queryClient.invalidateQueries({ queryKey: ['cash'] })
    ])
  }
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** A date as `YYYY-MM-DD` in local time, the form the main process expects. */
export function toDateInput(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A moment as the `YYYY-MM-DDTHH:mm` a datetime-local field wants, in local time. */
export function toDateTimeInput(date: Date): string {
  return `${toDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The first and last day of the current month. */
export function currentMonth(now = new Date()): { from: string; to: string } {
  return {
    from: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  }
}

/** `2026-01-05` → `05 Jan 2026`. */
export function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date)
}
