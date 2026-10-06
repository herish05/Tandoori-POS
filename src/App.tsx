import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { createQueryClient } from '@/lib/query-client'
import { AppRouter } from '@/router'
import { startConnectivityMonitoring } from '@/stores/connectivity.store'

export function App() {
  const [queryClient] = useState(createQueryClient)
  useEffect(() => startConnectivityMonitoring(), [])

  return (
    <ErrorBoundary scope="app">
      <QueryClientProvider client={queryClient}>
        <AppRouter />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
