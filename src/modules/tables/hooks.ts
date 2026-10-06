import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

/** Query keys for table data. Every mutation invalidates the whole `tables` and `areas` families. */
export const TABLE_KEYS = {
  floor: ['tables', 'floor'],
  list: ['tables', 'list'],
  areas: ['areas', 'list']
} as const

/** Returns a function that refreshes everything that shows areas or tables. */
export function useRefreshTables(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
      queryClient.invalidateQueries({ queryKey: ['areas'] })
    ])
  }
}

/** The current time, refreshed on an interval, for "open for 25 min" style labels. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, intervalMs)
    return () => {
      clearInterval(id)
    }
  }, [intervalMs])
  return now
}
