import { useQueryClient } from '@tanstack/react-query'

/** Query keys for order data. Every mutation refreshes the `orders` and `tables` families. */
export const ORDER_KEYS = {
  catalog: ['orders', 'catalog'],
  active: ['orders', 'list', 'active'],
  list: (filter: unknown) => ['orders', 'list', filter],
  detail: (id: string) => ['orders', 'detail', id]
} as const

/** How often open order screens re-read the server, so every terminal stays current. */
export const ORDER_REFRESH_MS = 5000

/** Returns a function that refreshes everything that shows orders or table states. */
export function useRefreshOrders(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
      queryClient.invalidateQueries({ queryKey: ['tables'] })
    ])
  }
}
