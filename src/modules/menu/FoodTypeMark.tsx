import { FOOD_TYPE_LABELS, type FoodType } from '@shared/menu'
import { cn } from '@/lib/utils'

const TONE: Record<FoodType, string> = {
  VEG: 'border-green-600 text-green-600',
  NON_VEG: 'border-red-600 text-red-600',
  EGG: 'border-amber-500 text-amber-500'
}

/** The familiar Indian food-type mark: a coloured dot in a square. */
export function FoodTypeMark({ type, className }: { type: FoodType; className?: string }) {
  return (
    <span
      role="img"
      aria-label={FOOD_TYPE_LABELS[type]}
      title={FOOD_TYPE_LABELS[type]}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-sm border-2',
        TONE[type],
        className
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  )
}
