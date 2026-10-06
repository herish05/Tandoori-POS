import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { handleAuthFailure } from '@/modules/auth/session-errors'
import { logger } from './logger'

/**
 * Local IPC calls are fast and deterministic, so automatic retries and refetch-on-focus would only
 * hide real faults. Failures are logged once, centrally, and surfaced by the screens that own them.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 },
      mutations: { retry: false }
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        handleAuthFailure(error)
        logger.error('Query failed', { queryKey: query.queryKey, error })
      }
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        handleAuthFailure(error)
        logger.error('Mutation failed', { error })
      }
    })
  })
}
