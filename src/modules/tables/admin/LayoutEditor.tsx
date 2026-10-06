import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, MoveDiagonal, RotateCcw, Save } from 'lucide-react'
import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react'
import { FLOOR_GRID, type DiningTable } from '@shared/tables'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { areaService, tableService } from '@/services/tables.service'
import { FloorGrid } from '../FloorGrid'
import { TABLE_KEYS, useRefreshTables } from '../hooks'
import { TableCard } from '../TableCard'

type Positions = Record<string, { x: number; y: number }>

const positionsOf = (tables: DiningTable[]): Positions =>
  Object.fromEntries(tables.map((t) => [t.id, { x: t.positionX, y: t.positionY }]))

const KEY_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
}

/**
 * Moves `id` to a cell. If another table is already there the two swap places, so a layout
 * can be rearranged without ever stacking two tables in one cell.
 */
function place(positions: Positions, id: string, x: number, y: number): Positions {
  const from = positions[id]
  if (!from) return positions
  if (x < 0 || y < 0 || x >= FLOOR_GRID.columns || y >= FLOOR_GRID.rows) return positions
  const next = { ...positions }
  const occupant = Object.entries(positions).find(
    ([other, p]) => other !== id && p.x === x && p.y === y
  )
  if (occupant) next[occupant[0]] = { ...from }
  next[id] = { x, y }
  return next
}

function LayoutCanvas({
  areaId,
  tables,
  canManage,
  justSaved,
  onSaved,
  onEdited
}: {
  areaId: string
  tables: DiningTable[]
  canManage: boolean
  /** Shown after a save; lives in the parent because saving remounts this component. */
  justSaved: boolean
  onSaved: () => void
  onEdited: () => void
}) {
  const refresh = useRefreshTables()
  const saved = useMemo(() => positionsOf(tables), [tables])
  const [positions, setPositions] = useState<Positions>(saved)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  const moved = tables.filter((t) => {
    const p = positions[t.id]
    return p !== undefined && (p.x !== t.positionX || p.y !== t.positionY)
  })
  const dirty = moved.length > 0

  const save = useMutation({
    mutationFn: () =>
      tableService.saveLayout({
        areaId,
        positions: tables.map((t) => ({
          id: t.id,
          positionX: positions[t.id]?.x ?? t.positionX,
          positionY: positions[t.id]?.y ?? t.positionY
        }))
      }),
    onSuccess: async () => {
      onSaved()
      await refresh()
    }
  })

  const shown = tables.map((t) => ({
    ...t,
    positionX: positions[t.id]?.x ?? t.positionX,
    positionY: positions[t.id]?.y ?? t.positionY
  }))

  const moveTo = (id: string, x: number, y: number): void => {
    save.reset()
    onEdited()
    setPositions((current) => place(current, id, x, y))
  }

  const onKeyDown = (event: KeyboardEvent, table: DiningTable): void => {
    const step = KEY_STEPS[event.key]
    const at = positions[table.id]
    if (!step || !at || !canManage) return
    event.preventDefault()
    moveTo(table.id, at.x + step[0], at.y + step[1])
  }

  const dropOn = (event: DragEvent, x: number, y: number): void => {
    event.preventDefault()
    if (dragId) moveTo(dragId, x, y)
    setDragId(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {canManage
            ? 'Drag a table to a free spot (dropping on another table swaps them), or select one and click a spot. Arrow keys also move the selected table.'
            : 'You can view the floor plan but not change it.'}
        </p>
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            {dirty && (
              <span className="text-sm font-medium text-warning">
                {moved.length} unsaved {moved.length === 1 ? 'change' : 'changes'}
              </span>
            )}
            <Button
              variant="outline"
              disabled={!dirty || save.isPending}
              onClick={() => {
                save.reset()
                onEdited()
                setPositions(saved)
                setSelectedId(null)
              }}
            >
              <RotateCcw /> Reset
            </Button>
            <Button
              disabled={!dirty || save.isPending}
              onClick={() => {
                save.mutate()
              }}
            >
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save />}
              Save layout
            </Button>
          </div>
        )}
      </div>

      {save.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(save.error)}
        </p>
      )}
      {justSaved && !dirty && (
        <p role="status" className="text-sm font-medium text-success">
          Layout saved. The POS floor now shows this arrangement.
        </p>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-4">
          <div
            className="min-w-[60rem] rounded-md border border-dashed bg-secondary/30 p-3"
            aria-label="Floor plan"
          >
            <FloorGrid
              tables={shown}
              mode="full"
              cellHeight="4.25rem"
              renderTable={(table) => (
                <TableCard
                  table={table}
                  size="compact"
                  selected={canManage ? selectedId === table.id : undefined}
                  draggable={canManage}
                  onSelect={(t) => {
                    if (!canManage) return
                    if (selectedId && selectedId !== t.id) {
                      const target = positions[t.id]
                      if (target) moveTo(selectedId, target.x, target.y)
                      setSelectedId(null)
                      return
                    }
                    setSelectedId(selectedId === t.id ? null : t.id)
                  }}
                  onKeyDown={(event) => {
                    onKeyDown(event, table)
                  }}
                  onDragStart={() => {
                    setDragId(table.id)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                  }}
                  onDragOver={(event) => {
                    if (canManage) event.preventDefault()
                  }}
                  onDrop={(event) => {
                    if (canManage) dropOn(event, table.positionX, table.positionY)
                  }}
                />
              )}
              renderEmptyCell={(x, y) => (
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={!canManage}
                  aria-label={`Empty spot column ${String(x + 1)} row ${String(y + 1)}`}
                  data-cell={`${String(x)},${String(y)}`}
                  onClick={() => {
                    if (!selectedId) return
                    moveTo(selectedId, x, y)
                    setSelectedId(null)
                  }}
                  onDragOver={(event) => {
                    if (canManage) event.preventDefault()
                  }}
                  onDrop={(event) => {
                    if (canManage) dropOn(event, x, y)
                  }}
                  className={cn(
                    'flex h-full w-full items-center justify-center rounded-md border border-dashed border-border/70 text-transparent transition-colors',
                    canManage &&
                      selectedId &&
                      'cursor-pointer hover:border-primary hover:bg-primary/10 hover:text-primary',
                    dragId && 'border-primary/50'
                  )}
                >
                  <MoveDiagonal className="size-4" aria-hidden />
                </button>
              )}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** Admin: arrange each area's tables on its floor plan. */
export function LayoutEditor({ canManage }: { canManage: boolean }) {
  const areas = useQuery({ queryKey: TABLE_KEYS.areas, queryFn: areaService.list, staleTime: 0 })
  const tables = useQuery({ queryKey: TABLE_KEYS.list, queryFn: tableService.list, staleTime: 0 })
  const [chosen, setChosen] = useState('')
  const [justSaved, setJustSaved] = useState(false)

  const choices = (areas.data ?? []).filter((area) => area.isActive)
  const areaId = choices.some((a) => a.id === chosen) ? chosen : (choices[0]?.id ?? '')
  const areaTables = (tables.data ?? []).filter((t) => t.areaId === areaId && t.isActive)
  // Remount the canvas whenever saved positions change so its draft state starts clean.
  const signature = areaTables
    .map((t) => `${t.id}@${String(t.positionX)},${String(t.positionY)}`)
    .join('|')

  if (areas.isPending || tables.isPending) return <Skeleton className="h-64" />
  if (choices.length === 0) {
    return (
      <p className="rounded-md bg-secondary px-3 py-6 text-center text-sm text-muted-foreground">
        Add an active area and some tables first, then arrange them here.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label htmlFor="layout-area" className="text-sm font-medium">
          Area
        </label>
        <Select
          id="layout-area"
          className="w-56"
          value={areaId}
          onChange={(event) => {
            setChosen(event.target.value)
            setJustSaved(false)
          }}
        >
          {choices.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </Select>
      </div>
      {areaTables.length === 0 ? (
        <p className="rounded-md bg-secondary px-3 py-6 text-center text-sm text-muted-foreground">
          This area has no active tables yet.
        </p>
      ) : (
        <LayoutCanvas
          key={`${areaId}:${signature}`}
          areaId={areaId}
          tables={areaTables}
          canManage={canManage}
          justSaved={justSaved}
          onSaved={() => {
            setJustSaved(true)
          }}
          onEdited={() => {
            setJustSaved(false)
          }}
        />
      )}
    </div>
  )
}
