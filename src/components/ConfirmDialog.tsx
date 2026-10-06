import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  destructive?: boolean
  pending?: boolean
  error?: string | undefined
  onConfirm: () => void
  onClose: () => void
}

/** "Are you sure?" prompt for actions that are hard to undo. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  destructive,
  pending,
  error,
  onConfirm,
  onClose
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <p className="text-sm text-muted-foreground">{message}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'default'}
          disabled={pending}
          onClick={onConfirm}
        >
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
