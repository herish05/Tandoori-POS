import { CalendarClock, Clock, Users } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { TABLE_TYPE_LABELS, type DiningTable } from '@shared/tables'
import { cn } from '@/lib/utils'
import { TABLE_STATUS_META } from './table-status'
import { formatElapsed, formatReservedTime } from './table-time'

export interface TableCardProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onSelect' | 'children'
> {
  table: DiningTable
  /** `regular` is the POS card; `compact` is for the layout editor. */
  size?: 'regular' | 'compact'
  /** Current time in ms, used for the "open for" label of occupied tables. */
  now?: number
  /** Highlights the card (layout editor selection). */
  selected?: boolean
  onSelect?: (table: DiningTable) => void
}

/**
 * One table, drawn the same way everywhere: number, seats, AC/Non-AC type and a
 * status colour. The POS floor, the table dialogs and the layout editor all use it.
 */
export function TableCard({
  table,
  size = 'regular',
  now,
  selected,
  onSelect,
  className,
  ...buttonProps
}: TableCardProps) {
  const meta = TABLE_STATUS_META[table.status]
  const compact = size === 'compact'
  const seated = table.openedAt !== null
  const status = table.isActive ? meta.label : 'Inactive'

  return (
    <button
      type="button"
      {...buttonProps}
      onClick={(event) => {
        buttonProps.onClick?.(event)
        onSelect?.(table)
      }}
      aria-label={`${table.displayName}, ${status}, seats ${String(table.capacity)}, ${TABLE_TYPE_LABELS[table.type]}`}
      {...(selected === undefined ? {} : { 'aria-pressed': selected })}
      data-table-id={table.id}
      data-status={table.status}
      className={cn(
        'flex w-full flex-col justify-between rounded-lg border-2 border-transparent p-2 text-left shadow-sm transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        compact ? 'h-full min-h-[3.5rem] gap-0.5' : 'min-h-[6.5rem] gap-1.5 p-3',
        meta.card,
        onSelect ? 'cursor-pointer hover:brightness-95' : 'cursor-default',
        !table.isActive && 'opacity-50 saturate-50',
        selected && 'border-foreground ring-2 ring-foreground/30',
        className
      )}
    >
      <span className="flex w-full items-start justify-between gap-1">
        <span
          className={cn(
            'min-w-0 truncate font-bold leading-tight',
            compact ? 'text-sm' : 'text-base'
          )}
        >
          {compact ? table.tableNumber : table.displayName}
        </span>
        <span className="shrink-0 rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none">
          {TABLE_TYPE_LABELS[table.type]}
        </span>
      </span>

      <span className="flex items-center gap-1 text-xs font-medium">
        <Users className="size-3.5" aria-hidden />
        {seated && table.guestCount !== null
          ? `${String(table.guestCount)} / ${String(table.capacity)}`
          : String(table.capacity)}
      </span>

      {!compact && (
        <span className="flex flex-col gap-0.5 text-xs">
          <span className="font-semibold">{status}</span>
          {table.reservedFor !== null && !seated && (
            <span className="flex items-center gap-1 font-medium">
              <CalendarClock className="size-3" aria-hidden />
              {table.reservedName ?? 'Reserved'} · {formatReservedTime(table.reservedFor)}
            </span>
          )}
          {seated && table.openedAt && now !== undefined && (
            <span className="flex items-center gap-1 opacity-80">
              <Clock className="size-3" aria-hidden />
              {formatElapsed(table.openedAt, now)}
            </span>
          )}
        </span>
      )}
    </button>
  )
}
