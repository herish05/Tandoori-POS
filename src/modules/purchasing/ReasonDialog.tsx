import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'

interface ReasonDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  pending: boolean
  error: string | undefined
  onConfirm: (reason: string) => void
  onClose: () => void
}

/** Asks for a written reason before a cancel or void; both are kept on the record. */
export function ReasonDialog(props: ReasonDialogProps) {
  return (
    <Dialog
      open={props.open}
      title={props.title}
      description={props.description}
      onClose={props.onClose}
    >
      <ReasonForm {...props} />
    </Dialog>
  )
}

function ReasonForm({ confirmLabel, pending, error, onConfirm, onClose }: ReasonDialogProps) {
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string>()

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    if (reason.trim().length === 0) {
      setProblem('A reason is required.')
      return
    }
    setProblem(undefined)
    onConfirm(reason.trim())
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Reason" required error={problem}>
        {(c) => (
          <Textarea
            {...c}
            autoFocus
            rows={3}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value)
            }}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Keep it
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {confirmLabel}
        </Button>
      </div>
    </form>
  )
}
