import { Cloud, CloudOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConnectivityStore } from '@/stores/connectivity.store'

/** Header indicator for network state. The POS keeps working when offline. */
export function ConnectivityIndicator({ className }: { className?: string }) {
  const status = useConnectivityStore((s) => s.status)
  const online = status === 'ONLINE'
  return (
    <div
      role="status"
      title={
        online
          ? 'Connected to the internet'
          : 'No internet connection. Orders and billing continue to work and will sync later.'
      }
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold',
        online ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning',
        className
      )}
    >
      {online ? (
        <Cloud className="size-4" aria-hidden />
      ) : (
        <CloudOff className="size-4" aria-hidden />
      )}
      {status}
    </div>
  )
}
