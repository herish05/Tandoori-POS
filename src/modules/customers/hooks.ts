import { useQueryClient } from '@tanstack/react-query'

/** Query keys for customer data. Every mutation refreshes the whole `customers` family. */
export const CUSTOMER_KEYS = {
  list: (filter: unknown) => ['customers', 'list', filter],
  detail: (id: string) => ['customers', 'detail', id],
  lookup: (query: string) => ['customers', 'lookup', query]
} as const

/** Returns a function that refreshes everything that shows customers. */
export function useRefreshCustomers(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['customers'] })
  }
}
