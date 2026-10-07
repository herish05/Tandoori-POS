import { useQueryClient } from '@tanstack/react-query'

/** Query keys for tickets and printers. */
export const KOT_KEYS = {
  board: (stationId: string | null) => ['kots', 'board', stationId],
  list: (filter: unknown) => ['kots', 'list', filter],
  preview: (id: string, paperWidth: number | null) => ['kots', 'preview', id, paperWidth],
  printers: ['printers', 'list'],
  systemDevices: ['printers', 'system-devices']
} as const

/** How often the kitchen display re-reads the tickets. */
export const KITCHEN_REFRESH_MS = 3000

/** Returns a function that refreshes everything that shows tickets, orders or table states. */
export function useRefreshKots(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['kots'] }),
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
      queryClient.invalidateQueries({ queryKey: ['tables'] })
    ])
  }
}
