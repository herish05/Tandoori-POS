import { useMutation } from '@tanstack/react-query'
import { Eye, Printer } from 'lucide-react'
import { useState } from 'react'
import {
  KOT_PRINT_STATUS_LABELS,
  KOT_STATUS_LABELS,
  OPEN_KOT_STATUSES,
  type KotSummary
} from '@shared/kitchen'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toUserMessage } from '@/lib/ipc'
import { ReasonDialog } from '@/modules/orders/ReasonDialog'
import { kotService } from '@/services/kitchen.service'
import { useRefreshKots } from './hooks'
import { KOT_PRINT_TONE, KOT_STATUS_TONE } from './kot-status'

interface OrderTicketsProps {
  kots: KotSummary[]
  canPrint: boolean
  canCancel: boolean
  onPreview: (kotId: string) => void
}

/** The kitchen tickets of one order: where each one stands, with preview, reprint and cancel. */
export function OrderTickets({ kots, canPrint, canCancel, onPreview }: OrderTicketsProps) {
  const refresh = useRefreshKots()
  const [cancelling, setCancelling] = useState<KotSummary | null>(null)

  const reprint = useMutation({
    mutationFn: (id: string) => kotService.print(id),
    onSuccess: async (result) => {
      await refresh()
      if (result.status === 'FAILED') onPreview(result.kotId)
    }
  })
  const cancel = useMutation({
    mutationFn: (input: { id: string; reason: string }) => kotService.cancel(input),
    onSuccess: async () => {
      await refresh()
      setCancelling(null)
    }
  })

  if (kots.length === 0) return null

  return (
    <section aria-label="Kitchen tickets" className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Kitchen tickets
      </h3>
      <ul className="space-y-2">
        {kots.map((kot) => (
          <li
            key={kot.id}
            className="rounded-md border bg-card p-2.5 text-sm"
            data-testid="order-kot"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{kot.kotNumber}</span>
              <Badge variant={KOT_STATUS_TONE[kot.status]}>{KOT_STATUS_LABELS[kot.status]}</Badge>
              {kot.isAdditional && <Badge variant="outline">Additional</Badge>}
              {kot.revision > 0 && <Badge variant="warning">Revised</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {kot.stationName} · {String(kot.itemCount)} item{kot.itemCount === 1 ? '' : 's'}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge variant={KOT_PRINT_TONE[kot.printStatus]}>
                {KOT_PRINT_STATUS_LABELS[kot.printStatus]}
              </Badge>
              <div className="ml-auto flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onPreview(kot.id)
                  }}
                >
                  <Eye /> View
                </Button>
                {canPrint && kot.status !== 'CANCELLED' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={reprint.isPending}
                    onClick={() => {
                      reprint.mutate(kot.id)
                    }}
                  >
                    <Printer /> Reprint
                  </Button>
                )}
              </div>
            </div>
            {kot.lastPrintError && (
              <p role="alert" className="mt-1 text-xs font-medium text-destructive">
                {kot.lastPrintError}
              </p>
            )}
            {kot.cancelReason && (
              <p className="mt-1 text-xs text-muted-foreground">Cancelled: {kot.cancelReason}</p>
            )}
            {canCancel && OPEN_KOT_STATUSES.includes(kot.status) && (
              <button
                type="button"
                className="mt-1 text-xs font-semibold text-destructive hover:underline"
                onClick={() => {
                  cancel.reset()
                  setCancelling(kot)
                }}
              >
                Cancel ticket
              </button>
            )}
          </li>
        ))}
      </ul>
      {reprint.isError && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {toUserMessage(reprint.error)}
        </p>
      )}

      <ReasonDialog
        open={cancelling !== null}
        title={cancelling ? `Cancel ${cancelling.kotNumber}?` : 'Cancel ticket?'}
        message="The kitchen is told this ticket is withdrawn. The ticket stays on record with your reason."
        confirmLabel="Cancel ticket"
        required
        pending={cancel.isPending}
        error={cancel.isError ? toUserMessage(cancel.error) : undefined}
        onConfirm={(reason) => {
          if (cancelling) cancel.mutate({ id: cancelling.id, reason })
        }}
        onClose={() => {
          setCancelling(null)
        }}
      />
    </section>
  )
}
