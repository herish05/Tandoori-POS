import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { PermissionCode } from '@shared/permissions'
import { ForbiddenPage } from '@/pages/ErrorPages'
import { hasPermission, useAuthStore } from '@/stores/auth.store'

interface RequireAuthProps {
  /** Every screen under this guard needs this permission. Omit for "any signed-in user". */
  permission?: PermissionCode
  children: ReactNode
}

/**
 * Route guard. This is a convenience for the user (no flash of a screen they cannot use); the
 * main process enforces the same rules on every call, so bypassing it exposes no data.
 */
export function RequireAuth({ permission, children }: RequireAuthProps) {
  const session = useAuthStore((s) => s.session)
  const location = useLocation()

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (session.user.mustChangePassword && location.pathname !== '/account') {
    return <Navigate to="/account" replace />
  }
  if (permission && !hasPermission(session, permission)) {
    return <ForbiddenPage />
  }
  return <>{children}</>
}
