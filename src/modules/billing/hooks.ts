import { useQueryClient } from '@tanstack/react-query'

/** Query keys for bills and the billing settings. */
export const BILL_KEYS = {
  settings: ['billing', 'settings'],
  list: (filter: unknown) => ['bills', 'list', filter],
  detail: (id: string) => ['bills', 'detail', id]
} as const

/** Query keys for receipts (the printed page and the print history of a bill). */
export const RECEIPT_KEYS = {
  preview: (billId: string, paperWidth: number | null) => [
    'receipts',
    'preview',
    billId,
    paperWidth
  ],
  history: (billId: string) => ['receipts', 'history', billId]
} as const

/** How often an open bill re-reads the server, so every terminal stays current. */
export const BILL_REFRESH_MS = 5000

/** Returns a function that refreshes everything a bill change can touch: bills, orders and tables. */
export function useRefreshBills(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bills'] }),
      queryClient.invalidateQueries({ queryKey: ['receipts'] }),
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
      queryClient.invalidateQueries({ queryKey: ['tables'] })
    ])
  }
}
