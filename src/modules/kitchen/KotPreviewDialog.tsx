import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Printer, FileText } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { PAPER_WIDTHS, type KotPrintOutcome, type PaperWidth } from '@shared/kitchen'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { kotService } from '@/services/kitchen.service'
import { KOT_KEYS, useRefreshKots } from './hooks'

interface KotPreviewDialogProps {
  /** The ticket to show; `null` closes the dialog. */
  kotId: string | null
  /** Why the preview was opened by itself, e.g. the printer could not be reached. */
  notice?: string | null
  /** May the signed-in user send the ticket to the printer? */
  canPrint: boolean
  onClose: () => void
}

/**
 * The ticket exactly as it prints. It doubles as the fallback when no printer is reachable: the
 * same text can be printed from this computer with the operating system's print dialog.
 */
export function KotPreviewDialog({ kotId, notice, canPrint, onClose }: KotPreviewDialogProps) {
  return (
    <Dialog open={kotId !== null} title="Kitchen ticket" onClose={onClose} className="max-w-md">
      {kotId && <PreviewBody kotId={kotId} notice={notice ?? null} canPrint={canPrint} />}
    </Dialog>
  )
}

function PreviewBody({
  kotId,
  notice,
  canPrint
}: {
  kotId: string
  notice: string | null
  canPrint: boolean
}) {
  const refresh = useRefreshKots()
  const [paperWidth, setPaperWidth] = useState<PaperWidth | null>(null)
  const [outcome, setOutcome] = useState<KotPrintOutcome | null>(null)

  const preview = useQuery({
    queryKey: KOT_KEYS.preview(kotId, paperWidth),
    queryFn: () => kotService.preview({ id: kotId, ...(paperWidth ? { paperWidth } : {}) }),
    staleTime: 0
  })
  const print = useMutation({
    mutationFn: () => kotService.print(kotId),
    onSuccess: async (result) => {
      setOutcome(result)
      await refresh()
    }
  })

  const shownWidth = paperWidth ?? preview.data?.paperWidth ?? 80
  const failure = outcome?.status === 'FAILED' ? outcome.error : null

  return (
    <div className="space-y-3">
      {notice && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          {notice}
        </p>
      )}

      <div className="flex items-center gap-2 text-sm" role="group" aria-label="Paper width">
        <span className="text-muted-foreground">Paper</span>
        {PAPER_WIDTHS.map((width) => (
          <button
            key={width}
            type="button"
            aria-pressed={shownWidth === width}
            onClick={() => {
              setPaperWidth(width)
            }}
            className={cn(
              'h-8 rounded-full border px-3 text-xs font-semibold transition-colors touch:h-10',
              shownWidth === width
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-accent'
            )}
          >
            {width} mm
          </button>
        ))}
      </div>

      {preview.isPending && <Skeleton className="h-64" />}
      {preview.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(preview.error)}
        </p>
      )}
      {preview.data && (
        <>
          <pre
            data-testid="kot-preview"
            data-selectable
            className="max-h-[50vh] overflow-auto rounded-md border bg-white p-3 font-mono text-[11px] leading-tight text-black"
          >
            {preview.data.lines.join('\n')}
          </pre>
          {createPortal(
            <div id="print-sheet" aria-hidden>
              {preview.data.lines.join('\n')}
            </div>,
            document.body
          )}
        </>
      )}

      {outcome?.status === 'PRINTED' && (
        <p role="status" className="text-sm font-medium text-success">
          Sent to {outcome.printerName ?? 'the printer'}.
        </p>
      )}
      {failure && (
        <p role="alert" className="text-sm font-medium text-destructive">
          Could not print: {failure} Use "Print from this computer" instead.
        </p>
      )}
      {print.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(print.error)}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button
          variant="outline"
          disabled={!preview.data}
          onClick={() => {
            window.print()
          }}
        >
          <FileText /> Print from this computer
        </Button>
        {canPrint && (
          <Button
            disabled={print.isPending}
            onClick={() => {
              print.mutate()
            }}
          >
            {print.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Printer />}
            Reprint
          </Button>
        )}
      </div>
    </div>
  )
}
