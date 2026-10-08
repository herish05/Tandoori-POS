import { useQueryClient } from '@tanstack/react-query'

/** Query keys for day closing. */
export const DAY_KEYS = {
  overview: ['day', 'overview'],
  status: (date: string) => ['day', 'status', date],
  list: (filter: unknown) => ['day', 'list', filter]
} as const

/**
 * Closing or reopening a day changes what can be recorded, and a count difference moves the cash
 * drawer, so everything that shows money is refreshed.
 */
export function useRefreshDay(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all(
      ['day', 'cash', 'expenses', 'bills', 'orders', 'purchases'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] })
      )
    )
  }
}
