/** "Just now", "25 min" or "1 h 05 m" since the table was opened. */
export function formatElapsed(openedAtIso: string, now: number): string {
  const opened = Date.parse(openedAtIso)
  if (Number.isNaN(opened)) return ''
  const minutes = Math.max(0, Math.floor((now - opened) / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${String(minutes)} min`
  const hours = Math.floor(minutes / 60)
  return `${String(hours)} h ${String(minutes % 60).padStart(2, '0')} m`
}

/** The clock time of a booking, e.g. "7:30 pm". */
export function formatReservedTime(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(at)
}
