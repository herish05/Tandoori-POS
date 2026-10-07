import type { KotPrintStatus, KotStatus } from '@shared/kitchen'

type BadgeTone = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

export const KOT_STATUS_TONE: Record<KotStatus, BadgeTone> = {
  NEW: 'warning',
  ACCEPTED: 'default',
  PREPARING: 'warning',
  READY: 'success',
  SERVED: 'secondary',
  CANCELLED: 'destructive'
}

export const KOT_PRINT_TONE: Record<KotPrintStatus, BadgeTone> = {
  NOT_PRINTED: 'secondary',
  PRINTED: 'success',
  NEEDS_REPRINT: 'warning',
  FAILED: 'destructive'
}

/** "12 min", "1 h 05 min": how long ago something happened. */
export function ageLabel(fromIso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000))
  if (minutes < 60) return `${String(minutes)} min`
  const hours = Math.floor(minutes / 60)
  return `${String(hours)} h ${String(minutes % 60).padStart(2, '0')} min`
}
