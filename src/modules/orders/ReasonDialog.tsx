import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

interface ReasonDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  /** Block confirming until the reason has at least 3 characters. */
  required: boolean
  pending: boolean
  error: string | undefined
  onConfirm: (reason: string) => void
  onClose: () => void
}

/** Asks "why?" before something that cannot be taken back (cancelling an item or an order). */
export function ReasonDialog({ open, ...rest }: ReasonDialogProps) {
  return (
    <Dialog open={open} title={rest.title} onClose={rest.onClose}>
      <ReasonForm {...rest} />
    </Dialog>
  )
}

function ReasonForm({
  message,
  confirmLabel,
  required,
  pending,
  error,
  onConfirm,
  onClose
}: Omit<ReasonDialogProps, 'open' | 'title'>) {
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()
  const tooShort = required && trimmed.length < 3

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="space-y-1.5">
        <label htmlFor="cancel-reason" className="text-sm font-semibold">
          Reason{required ? '' : ' (optional)'}
        </label>
        <Textarea
          id="cancel-reason"
          rows={2}
          maxLength={200}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value)
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Keep it
        </Button>
        <Button
          variant="destructive"
          disabled={pending || tooShort}
          onClick={() => {
            onConfirm(trimmed)
          }}
        >
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}
