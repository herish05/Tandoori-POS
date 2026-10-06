import { ShieldAlert } from 'lucide-react'
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { useEffect } from 'react'
import { ErrorFallback } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import { defaultRouteFor, useAuthStore } from '@/stores/auth.store'

export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <p className="text-5xl font-extrabold text-primary">404</p>
      <h1 className="text-xl font-bold">This page does not exist</h1>
      <Button asChild>
        <Link to="/">Go to start</Link>
      </Button>
    </div>
  )
}

/** Shown when a signed-in person opens an area their role does not include. */
export function ForbiddenPage() {
  const session = useAuthStore((s) => s.session)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <ShieldAlert className="size-12 text-primary" aria-hidden />
      <h1 className="text-xl font-bold">You do not have access to this area</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Your role does not include this section. Ask the restaurant owner if you need it.
      </p>
      <Button asChild>
        <Link to={session ? defaultRouteFor(session) : '/login'}>Go back</Link>
      </Button>
    </div>
  )
}

/** Route-level error element (loader/render errors that escape component boundaries). */
export function RouteErrorPage() {
  const error = useRouteError()

  useEffect(() => {
    logger.error('Route error', {
      error: isRouteErrorResponse(error)
        ? { status: error.status, data: error.data as unknown }
        : error
    })
  }, [error])

  return <ErrorFallback />
}
