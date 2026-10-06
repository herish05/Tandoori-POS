import { CheckCircle2, XCircle } from 'lucide-react'
import type { HealthReport } from '@shared/types'
import { cn } from '@/lib/utils'

const LABELS: Record<HealthReport['checks'][number]['name'], string> = {
  config: 'Configuration',
  logging: 'Logging',
  storage: 'Local storage',
  database: 'Local database',
  migrations: 'Database schema'
}

export function HealthChecklist({
  report,
  tone = 'light'
}: {
  report: HealthReport
  tone?: 'light' | 'dark'
}) {
  return (
    <ul className="space-y-2" data-selectable>
      {report.checks.map((check) => (
        <li key={check.name} className="flex items-start gap-3 text-sm">
          {check.status === 'ok' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="OK" />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />
          )}
          <div>
            <p className="font-semibold">{LABELS[check.name]}</p>
            <p
              className={cn(tone === 'dark' ? 'text-navy-foreground/70' : 'text-muted-foreground')}
            >
              {check.message}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
