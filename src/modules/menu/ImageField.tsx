import { ImagePlus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { MAX_ITEM_IMAGE_LENGTH } from '@shared/menu'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']
const MAX_SOURCE_BYTES = 8 * 1024 * 1024
/** Edge lengths to try, largest first, until the picture fits the stored size limit. */
const SIZES = [256, 192, 128, 96]
const QUALITIES = [0.82, 0.65, 0.5]

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file is not a readable image.'))
    }
    image.src = url
  })
}

/** Shrinks a picture to a small JPEG data URL that fits the stored size limit. */
async function shrink(file: File): Promise<string> {
  const image = await loadImage(file)
  const longest = Math.max(image.naturalWidth, image.naturalHeight)
  if (longest === 0) throw new Error('That file is not a readable image.')
  for (const size of SIZES) {
    const scale = Math.min(1, size / longest)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Pictures cannot be processed on this device.')
    // JPEG has no transparency; paint white first so transparent PNGs do not turn black.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of QUALITIES) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      if (dataUrl.length <= MAX_ITEM_IMAGE_LENGTH) return dataUrl
    }
  }
  throw new Error('That picture is too detailed to store. Try a simpler one.')
}

interface ImageFieldProps {
  value: string | null
  onChange: (value: string | null) => void
  error?: string | undefined
}

/** Picks a picture for a menu item and stores it as a small data URL with the item. */
export function ImageField({ value, onChange, error }: ImageFieldProps) {
  const id = useId()
  const [localError, setLocalError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (file: File | undefined): Promise<void> => {
    setLocalError(null)
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      setLocalError('The picture must be a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setLocalError('That picture is too large. Use one under 8 MB.')
      return
    }
    setBusy(true)
    try {
      onChange(await shrink(file))
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'That picture could not be used.')
    } finally {
      setBusy(false)
    }
  }

  const message = localError ?? error

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Picture (optional)</Label>
      <div className="flex items-center gap-4">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-md border bg-secondary">
          {value ? (
            <img src={value} alt="Item" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="space-y-2">
          <input
            id={id}
            type="file"
            accept={ACCEPTED.join(',')}
            disabled={busy}
            className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-semibold"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void onFile(file)
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
              <Trash2 /> Remove picture
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            PNG, JPEG or WebP. It is shrunk automatically to keep the app fast.
          </p>
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
