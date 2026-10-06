import { create } from 'zustand'
import type { SessionInfo } from '@shared/domain'
import type { PermissionCode } from '@shared/permissions'

export type AuthStatus = 'unknown' | 'signedOut' | 'signedIn'

interface AuthState {
  status: AuthStatus
  session: SessionInfo | null
  /** Set when the previous session ended on its own (idle or maximum length). */
  expired: boolean
  setSession: (session: SessionInfo) => void
  clear: (expired?: boolean) => void
  dismissExpired: () => void
}

/**
 * The renderer's *view* of the signed-in user, used only to show or hide screens. The main
 * process re-checks every permission on every call, so tampering with this store gains nothing.
 */
export const useAuthStore = create<AuthState>()((set) => ({
  status: 'unknown',
  session: null,
  expired: false,
  setSession: (session) => {
    set({ status: 'signedIn', session, expired: false })
  },
  clear: (expired = false) => {
    set((state) => ({ status: 'signedOut', session: null, expired: expired || state.expired }))
  },
  dismissExpired: () => {
    set({ expired: false })
  }
}))

export function hasPermission(session: SessionInfo | null, code: PermissionCode): boolean {
  return session?.user.permissions.includes(code) ?? false
}

export function usePermission(code: PermissionCode): boolean {
  return useAuthStore((s) => hasPermission(s.session, code))
}

/** Where a signed-in person lands: the first area they are allowed into. */
export function defaultRouteFor(session: SessionInfo): string {
  if (session.user.mustChangePassword) return '/account'
  const { permissions } = session.user
  if (permissions.includes('pos.access')) return '/pos'
  if (permissions.includes('admin.access')) return '/admin'
  if (permissions.includes('kitchen.access')) return '/kitchen'
  return '/account'
}
