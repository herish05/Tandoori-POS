import { useState } from 'react'
import type { ReportColumn, ReportResult } from '@shared/reports'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCell, isNumericColumn } from './cells'

const PAGE = 200

function SummaryCards({ result }: { result: ReportResult }) {
  if (result.summary.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="report-summary">
      {result.summary.map((item) => (
        <div key={item.label} className="rounded-lg border bg-card p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{item.label}</div>
          <div className="mt-1 text-lg font-bold">{formatCell(item.value, item.type)}</div>
        </div>
      ))}
    </div>
  )
}

const cellClass = (column: ReportColumn): string =>
  cn('px-3 py-2', isNumericColumn(column.type) && 'text-right tabular-nums')

/** The result of a report as a table. Mount it with a new `key` per result so paging starts over. */
export function ReportTable({ result }: { result: ReportResult }) {
  const [shown, setShown] = useState(PAGE)
  const rows = result.rows.slice(0, shown)

  return (
    <div className="space-y-3">
      <SummaryCards result={result} />
      {result.truncated && (
        <p
          role="status"
          className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
          data-testid="report-truncated"
        >
          This report is very long, so only its first {String(result.rows.length)} rows are shown.
          Narrow the dates or the filters to see the rest.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm" data-testid="report-table">
          <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              {result.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn('px-3 py-2', isNumericColumn(column.type) && 'text-right')}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.rows.length === 0 && (
              <tr>
                <td
                  className="px-3 py-8 text-center text-muted-foreground"
                  colSpan={result.columns.length}
                >
                  Nothing to show for these dates and filters.
                </td>
              </tr>
            )}
            {rows.map((row, index) => (
              <tr key={index} className="hover:bg-accent/40">
                {result.columns.map((column) => (
                  <td key={column.key} className={cellClass(column)}>
                    {formatCell(row[column.key] ?? null, column.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {result.totals && (
            <tfoot className="border-t-2 bg-secondary/40 font-semibold">
              <tr data-testid="report-totals">
                {result.columns.map((column) => (
                  <td key={column.key} className={cellClass(column)}>
                    {formatCell(result.totals?.[column.key] ?? null, column.type)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {result.rows.length > shown && (
        <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
          Showing {String(shown)} of {String(result.rows.length)} rows
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShown(shown + PAGE)
            }}
          >
            Show more
          </Button>
        </div>
      )}
    </div>
  )
}
