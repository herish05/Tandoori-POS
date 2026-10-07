import { useMutation, useQuery } from '@tanstack/react-query'
import { FileText, Loader2, Printer } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { PAPER_WIDTHS, type PaperWidth } from '@shared/kitchen'
import type { ReceiptPrintOutcome } from '@shared/receipts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { receiptService } from '@/services/billing.service'
import { RECEIPT_KEYS, useRefreshBills } from './hooks'

interface ReceiptPreviewDialogProps {
  /** The bill to show; `null` closes the dialog. */
  billId: string | null
  /** May the signed-in user send the receipt to the printer? */
  canPrint: boolean
  onClose: () => void
}

/**
 * The bill or receipt exactly as it prints. It doubles as the fallback when no printer is
 * reachable: the same text can be printed from this computer with the operating system's dialog.
 */
export function ReceiptPreviewDialog({ billId, canPrint, onClose }: ReceiptPreviewDialogProps) {
  return (
    <Dialog open={billId !== null} title="Receipt" onClose={onClose} className="max-w-md">
      {billId && <PreviewBody billId={billId} canPrint={canPrint} />}
    </Dialog>
  )
}

function PreviewBody({ billId, canPrint }: { billId: string; canPrint: boolean }) {
  const refresh = useRefreshBills()
  const [paperWidth, setPaperWidth] = useState<PaperWidth | null>(null)
  const [outcome, setOutcome] = useState<ReceiptPrintOutcome | null>(null)

  const preview = useQuery({
    queryKey: RECEIPT_KEYS.preview(billId, paperWidth),
    queryFn: () => receiptService.preview({ billId, ...(paperWidth ? { paperWidth } : {}) }),
    staleTime: 0
  })
  const print = useMutation({
    mutationFn: () => receiptService.print({ billId }),
    onSuccess: async (result) => {
      setOutcome(result)
      await refresh()
    }
  })

  const shownWidth = paperWidth ?? preview.data?.paperWidth ?? 80
  const failure = outcome?.status === 'FAILED' ? outcome.error : null
  const duplicate = (preview.data?.copyNumber ?? 0) > 0

  return (
    <div className="space-y-3">
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
            data-testid="receipt-preview"
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
          Sent to {outcome.printerName ?? 'the printer'}
          {outcome.copyNumber > 0 ? ` as duplicate copy ${String(outcome.copyNumber)}` : ''}.
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
            disabled={print.isPending || !preview.data}
            onClick={() => {
              print.mutate()
            }}
          >
            {print.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Printer />}
            {duplicate ? 'Print duplicate' : 'Print'}
          </Button>
        )}
      </div>
    </div>
  )
}
