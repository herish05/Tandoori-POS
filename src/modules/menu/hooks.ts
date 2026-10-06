import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

/** Query keys for menu data. Every mutation refreshes the whole `menu` family. */
export const MENU_KEYS = {
  stations: ['menu', 'stations'],
  categories: ['menu', 'categories'],
  taxCategories: ['menu', 'tax-categories'],
  addons: ['menu', 'addons'],
  items: (filter: unknown) => ['menu', 'items', filter],
  demo: ['menu', 'demo']
} as const

/** Returns a function that refreshes everything that shows menu data. */
export function useRefreshMenu(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['menu'] })
  }
}

/** Follows `value` after it has stopped changing for `delayMs` (for search boxes). */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(value)
    }, delayMs)
    return () => {
      clearTimeout(id)
    }
  }, [value, delayMs])
  return debounced
}
