import { IpcError } from '@/lib/ipc'
import { useAuthStore } from '@/stores/auth.store'

/**
 * Called for any failed IPC call: if the main process says the session is gone, the renderer
 * drops its copy so route guards send the person back to the sign-in screen.
 */
export function handleAuthFailure(error: unknown): void {
  if (!(error instanceof IpcError)) return
  if (error.code === 'SESSION_EXPIRED') useAuthStore.getState().clear(true)
  else if (error.code === 'UNAUTHENTICATED') useAuthStore.getState().clear(false)
}
