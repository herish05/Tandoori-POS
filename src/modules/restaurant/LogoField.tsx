import { ImagePlus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const MAX_FILE_BYTES = 300 * 1024
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']

interface LogoFieldProps {
  value: string | null
  onChange: (value: string | null) => void
  error?: string | undefined
}

/** Picks a small PNG/JPEG/WebP and keeps it as a data URL, so it is stored with the restaurant record. */
export function LogoField({ value, onChange, error }: LogoFieldProps) {
  const id = useId()
  const [localError, setLocalError] = useState<string | null>(null)

  const onFile = (file: File | undefined): void => {
    setLocalError(null)
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      setLocalError('The logo must be a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setLocalError('The logo is too large. Use an image under 300 KB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') onChange(reader.result)
    }
    reader.onerror = () => {
      setLocalError('That file could not be read.')
    }
    reader.readAsDataURL(file)
  }

  const message = localError ?? error

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Logo (optional)</Label>
      <div className="flex items-center gap-4">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-md border bg-secondary">
          {value ? (
            <img src={value} alt="Restaurant logo" className="size-full object-contain" />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="space-y-2">
          <input
            id={id}
            type="file"
            accept={ACCEPTED.join(',')}
            className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-semibold"
            onChange={(event) => {
              onFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          {value && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLocalError(null)
                onChange(null)
              }}
            >
              <Trash2 /> Remove logo
            </Button>
          )}
          <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 300 KB.</p>
        </div>
      </div>
      {message && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {message}
        </p>
      )}
    </div>
  )
}
