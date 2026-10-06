import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { logger } from '@/lib/logger'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'
import { handleAuthFailure } from './session-errors'

const POLL_MS = 15_000
const ACTIVITY_THROTTLE_MS = 30_000

/**
 * Keeps the renderer's view of the session in step with the main process (the real authority):
 * loads it at start-up, re-checks it every few seconds so an expiry is noticed promptly even on a
 * quiet screen, and reports genuine activity so an in-use session does not time out.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status)
  const queryClient = useQueryClient()

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      authService
        .getSession()
        .then((snapshot) => {
          if (cancelled) return
          const { session, setSession, clear } = useAuthStore.getState()
          if (snapshot.session) {
            if (JSON.stringify(session) !== JSON.stringify(snapshot.session)) {
              setSession(snapshot.session)
            }
          } else {
            clear(snapshot.expired)
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return
          logger.warn('Could not read the session', { error })
          useAuthStore.getState().clear()
        })
    }
    refresh()
    const timer = window.setInterval(refresh, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let lastSent = 0
    const onActivity = (): void => {
      if (useAuthStore.getState().status !== 'signedIn') return
      const now = Date.now()
      if (now - lastSent < ACTIVITY_THROTTLE_MS) return
      lastSent = now
      authService.touch().catch(handleAuthFailure)
    }
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)
    return () => {
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [])

  // Nothing that belongs to one person's session may linger in memory after sign-out.
  useEffect(() => {
    if (status === 'signedOut') {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'system' })
    }
  }, [status, queryClient])

  if (status === 'unknown') {
    return (
      <div className="flex h-full items-center justify-center" role="status">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    )
  }
  return <>{children}</>
}
