import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { toUserMessage } from '@/lib/ipc'
import { auditService } from '@/services/auth.service'

const PAGE_SIZE = 25

const AREAS = [
  { value: '', label: 'All activity' },
  { value: 'auth.', label: 'Sign-in and sessions' },
  { value: 'user.', label: 'Staff' },
  { value: 'role.', label: 'Roles' },
  { value: 'area.', label: 'Areas' },
  { value: 'table.', label: 'Tables' },
  { value: 'menu.', label: 'Menu' },
  { value: 'order.', label: 'Orders' },
  { value: 'kot.', label: 'Kitchen tickets' },
  { value: 'bill', label: 'Bills and payments' },
  { value: 'printer.', label: 'Printers' },
  { value: 'restaurant.', label: 'Restaurant settings' },
  { value: 'setup.', label: 'Setup' }
] as const

const OUTCOMES = [
  { value: '', label: 'Any result' },
  { value: 'SUCCESS', label: 'Successful' },
  { value: 'FAILURE', label: 'Failed or denied' }
] as const

function summarise(details: Record<string, unknown> | null): string {
  if (!details) return ''
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' · ')
}

export function AuditLogsPage() {
  const [page, setPage] = useState(1)
  const [area, setArea] = useState('')
  const [outcome, setOutcome] = useState<'' | 'SUCCESS' | 'FAILURE'>('')

  const logs = useQuery({
    queryKey: ['audit', page, area, outcome],
    queryFn: () =>
      auditService.list({
        page,
        pageSize: PAGE_SIZE,
        ...(area ? { actionPrefix: area } : {}),
        ...(outcome ? { outcome } : {})
      }),
    staleTime: 0,
    placeholderData: (previous) => previous
  })

  const pages = logs.data ? Math.max(1, Math.ceil(logs.data.total / logs.data.pageSize)) : 1

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h2 className="text-xl font-bold">Audit logs</h2>
        <p className="text-sm text-muted-foreground">
          A permanent record of who did what. Passwords are never recorded.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-xs font-medium">
          Area
          <Select
            className="w-52"
            value={area}
            onChange={(event) => {
              setArea(event.target.value)
              setPage(1)
            }}
          >
            {AREAS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          Result
          <Select
            className="w-44"
            value={outcome}
            onChange={(event) => {
              setOutcome(event.target.value as typeof outcome)
              setPage(1)
            }}
          >
            {OUTCOMES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {logs.isPending && <Skeleton className="m-5 h-48" />}
          {logs.isError && (
            <p role="alert" className="p-5 text-sm text-destructive">
              {toUserMessage(logs.error)}
            </p>
          )}
          {logs.data && (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Who</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Nothing recorded for this filter.
                    </td>
                  </tr>
                )}
                {logs.data.items.map((entry) => (
                  <tr key={entry.id} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3">{entry.username ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{entry.action}</td>
                    <td className="px-4 py-3">
                      <Badge variant={entry.outcome === 'SUCCESS' ? 'success' : 'destructive'}>
                        {entry.outcome === 'SUCCESS' ? 'OK' : 'Denied / failed'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {summarise(entry.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {logs.data ? `${String(logs.data.total)} entries` : ''}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              setPage((value) => value - 1)
            }}
          >
            <ChevronLeft /> Newer
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => {
              setPage((value) => value + 1)
            }}
          >
            Older <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
