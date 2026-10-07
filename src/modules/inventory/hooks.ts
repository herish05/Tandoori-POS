import { useQueryClient } from '@tanstack/react-query'

/** Query keys for stock data. Every mutation refreshes the whole `inventory` family. */
export const INVENTORY_KEYS = {
  summary: ['inventory', 'summary'],
  list: (filter: unknown) => ['inventory', 'list', filter],
  movements: (filter: unknown) => ['inventory', 'movements', filter],
  coverage: ['inventory', 'coverage'],
  recipe: (menuItemId: string) => ['inventory', 'recipe', menuItemId]
} as const

/** Returns a function that refreshes everything that shows stock or recipes. */
export function useRefreshInventory(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory'] })
  }
}
