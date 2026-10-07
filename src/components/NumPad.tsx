import { Delete } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PadKey } from '@/lib/numpad'

const KEYS: { key: PadKey; label: string }[] = [
  { key: '7', label: '7' },
  { key: '8', label: '8' },
  { key: '9', label: '9' },
  { key: '4', label: '4' },
  { key: '5', label: '5' },
  { key: '6', label: '6' },
  { key: '1', label: '1' },
  { key: '2', label: '2' },
  { key: '3', label: '3' },
  { key: '00', label: '00' },
  { key: '0', label: '0' },
  { key: '.', label: '.' }
]

/** An on-screen number pad for amounts, so a touch screen never needs the system keyboard. */
export function NumPad({ onKey, disabled }: { onKey: (key: PadKey) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Number pad">
      {KEYS.map(({ key, label }, index) => (
        <Button
          key={key}
          variant="outline"
          disabled={disabled}
          className="h-14 text-xl font-bold"
          style={{ gridColumn: (index % 3) + 1 }}
          onClick={() => {
            onKey(key)
          }}
        >
          {label}
        </Button>
      ))}
      <Button
        variant="secondary"
        disabled={disabled}
        aria-label="Backspace"
        className="col-start-4 row-start-1 h-14"
        onClick={() => {
          onKey('back')
        }}
      >
        <Delete />
      </Button>
      <Button
        variant="secondary"
        disabled={disabled}
        className="col-start-4 row-span-3 row-start-2 h-auto text-base"
        onClick={() => {
          onKey('clear')
        }}
      >
        Clear
      </Button>
    </div>
  )
}
