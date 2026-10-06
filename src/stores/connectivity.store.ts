import { create } from 'zustand'

export type ConnectivityStatus = 'ONLINE' | 'OFFLINE'

interface ConnectivityState {
  status: ConnectivityStatus
  /** Last time the status changed (epoch ms). Null until the first change. */
  changedAt: number | null
  setOnline: (online: boolean) => void
}

/**
 * Tracks whether the machine has network connectivity.
 * The POS keeps working when OFFLINE; this only drives the header indicator. The richer
 * ONLINE / OFFLINE / SYNCING / SYNC ERROR state arrives with the sync module (Phase 19).
 */
export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  status: navigator.onLine ? 'ONLINE' : 'OFFLINE',
  changedAt: null,
  setOnline: (online) => {
    const next: ConnectivityStatus = online ? 'ONLINE' : 'OFFLINE'
    if (get().status !== next) set({ status: next, changedAt: Date.now() })
  }
}))

/** Wires browser online/offline events into the store. Returns an unsubscribe function. */
export function startConnectivityMonitoring(): () => void {
  const { setOnline } = useConnectivityStore.getState()
  const onOnline = (): void => {
    setOnline(true)
  }
  const onOffline = (): void => {
    setOnline(false)
  }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}
