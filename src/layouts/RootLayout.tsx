import { Outlet } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SessionProvider } from '@/modules/auth/SessionProvider'

/** Top-level layout: every screen renders inside an error boundary. */
export function RootLayout() {
  return (
    <div className="h-full">
      <ErrorBoundary scope="root">
        <SessionProvider>
          <Outlet />
        </SessionProvider>
      </ErrorBoundary>
    </div>
  )
}
