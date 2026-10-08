import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, FileText, Printer } from 'lucide-react'
import { useState } from 'react'
import { REPORT_GROUPS, REPORT_KINDS, REPORTS, type ReportFilterInput } from '@shared/reports'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import {
  initialDraft,
  REPORT_KEYS,
  switchKind,
  toFilter,
  type ReportDraft
} from '@/modules/reports/draft'
import { ReportFilters } from '@/modules/reports/ReportFilters'
import { ReportTable } from '@/modules/reports/ReportTable'
import { reportsService } from '@/services/reports.service'
import { usePermission } from '@/stores/auth.store'

/** Admin: pick a report, choose the dates and filters, then read, print, save as PDF or export as CSV. */
export function ReportsPage() {
  const canExport = usePermission('reports.export')
  const [draft, setDraft] = useState<ReportDraft>(() => initialDraft())
  const [applied, setApplied] = useState<ReportFilterInput>(() => toFilter(initialDraft()))
  const [notice, setNotice] = useState<string | null>(null)

  const options = useQuery({
    queryKey: REPORT_KEYS.options,
    queryFn: () => reportsService.options(),
    staleTime: 60_000
  })
  const report = useQuery({
    queryKey: REPORT_KEYS.run(applied),
    queryFn: () => reportsService.run(applied),
    staleTime: 0,
    retry: false
  })

  const done = (verb: string) => (result: { saved: boolean; path: string | null } | null) => {
    if (result === null) setNotice(`${verb} sent to the printer.`)
    else setNotice(result.saved ? `Saved to ${result.path ?? 'the chosen place'}.` : null)
  }
  const exportCsv = useMutation({
    mutationFn: reportsService.exportCsv,
    onSuccess: done('CSV')
  })
  const exportPdf = useMutation({
    mutationFn: reportsService.exportPdf,
    onSuccess: done('PDF')
  })
  const print = useMutation({
    mutationFn: reportsService.print,
    onSuccess: done('Report')
  })
  const exporting = exportCsv.isPending || exportPdf.isPending || print.isPending
  const exportError = exportCsv.error ?? exportPdf.error ?? print.error

  const run = () => {
    setNotice(null)
    setApplied(toFilter(draft))
  }
  const choose = (kind: ReportDraft['kind']) => {
    const next = switchKind(draft, kind)
    setDraft(next)
    setNotice(null)
    setApplied(toFilter(next))
  }
  const meta = REPORTS[draft.kind]
  const result = report.data

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h2 className="text-xl font-bold">Reports</h2>
        <p className="text-sm text-muted-foreground">
          Sales, kitchen, stock and money reports. What is on screen is what is printed, saved as a
          PDF or exported as CSV.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Reports" className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          {REPORT_GROUPS.map((group) => (
            <div key={group}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </h3>
              <ul className="space-y-0.5">
                {REPORT_KINDS.filter((kind) => REPORTS[kind].group === group).map((kind) => (
                  <li key={kind}>
                    <button
                      type="button"
                      aria-current={draft.kind === kind ? 'page' : undefined}
                      className={cn(
                        'w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent',
                        draft.kind === kind && 'bg-accent font-semibold'
                      )}
                      onClick={() => {
                        choose(kind)
                      }}
                    >
                      {REPORTS[kind].label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <section className="min-w-0 space-y-3" aria-label={meta.label}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">{meta.label}</h3>
              <p className="text-sm text-muted-foreground">{meta.description}</p>
            </div>
            {canExport && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting || !result}
                  onClick={() => {
                    setNotice(null)
                    exportCsv.mutate(applied)
                  }}
                >
                  <Download aria-hidden /> CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting || !result}
                  onClick={() => {
                    setNotice(null)
                    exportPdf.mutate(applied)
                  }}
                >
                  <FileText aria-hidden /> PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting || !result}
                  onClick={() => {
                    setNotice(null)
                    print.mutate(applied)
                  }}
                >
                  <Printer aria-hidden /> Print
                </Button>
              </div>
            )}
          </div>

          <ReportFilters
            draft={draft}
            options={options.data}
            busy={report.isFetching}
            onChange={setDraft}
            onRun={run}
          />

          {notice && (
            <p role="status" className="text-sm font-medium text-success">
              {notice}
            </p>
          )}
          {exportError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {toUserMessage(exportError)}
            </p>
          )}
          {report.isError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {toUserMessage(report.error)}
            </p>
          )}
          {report.isPending && <Skeleton className="h-64 w-full" />}

          {result && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="report-scope">
                {result.from} to {result.to}
                {result.filters.length > 0 ? ` · ${result.filters.join(' · ')}` : ''}
              </p>
              <ReportTable key={`${result.kind}-${result.generatedAt}`} result={result} />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
