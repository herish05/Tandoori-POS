import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { FLOOR_GRID, type DiningTable } from '@shared/tables'
import { cn } from '@/lib/utils'

interface FloorGridProps {
  tables: DiningTable[]
  /**
   * `compact` (POS): rows and columns that hold no table are dropped, so the floor never has
   * big gaps but keeps its relative arrangement.
   * `full` (layout editor): the whole floor plan is drawn, with `renderEmptyCell` for free spots.
   */
  mode: 'compact' | 'full'
  renderTable: (table: DiningTable) => ReactNode
  renderEmptyCell?: (x: number, y: number) => ReactNode
  className?: string
  cellHeight?: string
}

const ranks = (values: number[]): Map<number, number> =>
  new Map([...new Set(values)].sort((a, b) => a - b).map((value, index) => [value, index + 1]))

/** Places tables on the area's floor grid using their saved positions. */
export function FloorGrid({
  tables,
  mode,
  renderTable,
  renderEmptyCell,
  className,
  cellHeight = '6.75rem'
}: FloorGridProps) {
  const layout = useMemo(() => {
    if (mode === 'full') {
      return {
        columns: FLOOR_GRID.columns,
        rows: FLOOR_GRID.rows,
        column: (x: number): number => x + 1,
        row: (y: number): number => y + 1
      }
    }
    const columnRank = ranks(tables.map((t) => t.positionX))
    const rowRank = ranks(tables.map((t) => t.positionY))
    return {
      columns: columnRank.size,
      rows: rowRank.size,
      column: (x: number): number => columnRank.get(x) ?? 1,
      row: (y: number): number => rowRank.get(y) ?? 1
    }
  }, [mode, tables])

  const occupied = useMemo(
    () => new Set(tables.map((t) => `${String(t.positionX)},${String(t.positionY)}`)),
    [tables]
  )

  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${String(layout.columns)}, minmax(${mode === 'full' ? '5.5rem' : '8.5rem'}, ${mode === 'full' ? '1fr' : '11rem'}))`,
    gridAutoRows: cellHeight
  }

  return (
    <div className={cn('grid gap-3', mode === 'full' && 'gap-1.5', className)} style={style}>
      {tables.map((table) => (
        <div
          key={table.id}
          style={{
            gridColumn: layout.column(table.positionX),
            gridRow: layout.row(table.positionY)
          }}
        >
          {renderTable(table)}
        </div>
      ))}
      {mode === 'full' &&
        renderEmptyCell &&
        Array.from({ length: FLOOR_GRID.rows * FLOOR_GRID.columns }, (_, index) => {
          const x = index % FLOOR_GRID.columns
          const y = Math.floor(index / FLOOR_GRID.columns)
          if (occupied.has(`${String(x)},${String(y)}`)) return null
          return (
            <div key={`${String(x)}-${String(y)}`} style={{ gridColumn: x + 1, gridRow: y + 1 }}>
              {renderEmptyCell(x, y)}
            </div>
          )
        })}
    </div>
  )
}
