import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { TABLE_TYPE_LABELS, TABLE_TYPES, type DiningTable, type TableType } from '@shared/tables'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { ORDER_KEYS, ORDER_REFRESH_MS } from '@/modules/orders/hooks'
import { OrdersList } from '@/modules/orders/OrdersList'
import { FloorGrid } from '@/modules/tables/FloorGrid'
import { TABLE_KEYS, useNow } from '@/modules/tables/hooks'
import { TableActions } from '@/modules/tables/TableActions'
import { TableCard } from '@/modules/tables/TableCard'
import { TABLE_STATUS_META, TABLE_STATUSES } from '@/modules/tables/table-status'
import { orderService } from '@/services/orders.service'
import { tableService } from '@/services/tables.service'
import { usePermission } from '@/stores/auth.store'

/** How often the floor re-reads table states, so every counter stays current. */
const REFRESH_MS = 5000

type TypeFilter = 'ALL' | TableType

function FilterChip({
  active,
  label,
  count,
  onClick
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-card text-foreground hover:bg-accent'
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 text-xs',
          active ? 'bg-primary-foreground/20' : 'bg-secondary text-muted-foreground'
        )}
      >
        {count}
      </span>
    </button>
  )
}

/** POS home: the table floor, or the list of orders for those who may see orders. */
export function PosPage() {
  const canViewOrders = usePermission('orders.view')
  const [params, setParams] = useSearchParams()
  const view = canViewOrders && params.get('view') === 'orders' ? 'orders' : 'tables'

  const tab = (value: 'tables' | 'orders', label: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => {
        setParams(value === 'orders' ? { view: 'orders' } : {}, { replace: true })
      }}
      className={cn(
        'h-9 rounded-md px-4 text-sm font-semibold transition-colors',
        view === value ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="flex h-full flex-col">
      {canViewOrders && (
        <div className="flex gap-1 border-b bg-card px-5 py-2" role="group" aria-label="POS view">
          {tab('tables', 'Tables')}
          {tab('orders', 'Orders')}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {view === 'orders' ? (
          <div className="h-full overflow-auto">
            <OrdersList />
          </div>
        ) : (
          <TableView />
        )}
      </div>
    </div>
  )
}

/**
 * Table view: toolbar, AC / Non-AC filters, status legend, then every area laid out as the admin
 * arranged it. Table states refresh every few seconds.
 */
function TableView() {
  const navigate = useNavigate()
  const canView = usePermission('tables.view')
  const canOperate = usePermission('tables.operate')
  const canOrder = usePermission('orders.operate')
  const canViewOrders = usePermission('orders.view')
  const canManage = usePermission('tables.manage')
  const canAdmin = usePermission('admin.access')
  const now = useNow()
  const [filter, setFilter] = useState<TypeFilter>('ALL')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const floor = useQuery({
    queryKey: TABLE_KEYS.floor,
    queryFn: tableService.floor,
    enabled: canView,
    refetchInterval: REFRESH_MS,
    staleTime: 0
  })

  const activeOrders = useQuery({
    queryKey: ORDER_KEYS.active,
    queryFn: () => orderService.list({ activeOnly: true, limit: 200 }),
    enabled: canViewOrders,
    refetchInterval: ORDER_REFRESH_MS,
    staleTime: 0
  })

  /** A table with an order in progress opens that order; any other opens the table actions. */
  const selectTable = (table: DiningTable): void => {
    const order = activeOrders.data?.find((entry) => entry.tableId === table.id)
    if (order) {
      void navigate(`/pos/orders/${order.id}`)
      return
    }
    setSelectedId(table.id)
  }

  const takeOrder = (table: DiningTable, guests: number | null): void => {
    const query = new URLSearchParams({ type: 'DINE_IN', table: table.id })
    if (guests !== null) query.set('guests', String(guests))
    void navigate(`/pos/orders/new?${query.toString()}`)
  }

  const allTables = useMemo(() => (floor.data ?? []).flatMap((area) => area.tables), [floor.data])
  const selected = allTables.find((table) => table.id === selectedId) ?? null

  const counts = useMemo(() => {
    const byType = new Map<TableType, number>()
    for (const table of allTables) byType.set(table.type, (byType.get(table.type) ?? 0) + 1)
    return byType
  }, [allTables])
  const occupied = allTables.filter(
    (t) => t.status !== 'AVAILABLE' && t.status !== 'BLOCKED'
  ).length
  const matches = (table: DiningTable): boolean => filter === 'ALL' || table.type === filter
  const visibleAreas = (floor.data ?? [])
    .map((area) => ({ ...area, visible: area.tables.filter(matches) }))
    .filter((area) => area.visible.length > 0)

  const typesPresent = TABLE_TYPES.filter((type) => (counts.get(type) ?? 0) > 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-card px-5 py-3">
        <div>
          <h1 className="text-lg font-bold">Table view</h1>
          {floor.data && allTables.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {occupied} of {allTables.length} tables in use
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh tables"
            disabled={!canView || floor.isFetching}
            onClick={() => {
              void floor.refetch()
            }}
          >
            <RefreshCw className={cn(floor.isFetching && 'animate-spin')} />
          </Button>
          <Button
            disabled={!canOrder}
            onClick={() => {
              void navigate('/pos/orders/new?type=DELIVERY')
            }}
          >
            Delivery
          </Button>
          <Button
            disabled={!canOrder}
            onClick={() => {
              void navigate('/pos/orders/new?type=TAKEAWAY')
            }}
          >
            Take away
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        {typesPresent.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Filter by table type"
          >
            <FilterChip
              active={filter === 'ALL'}
              label="All"
              count={allTables.length}
              onClick={() => {
                setFilter('ALL')
              }}
            />
            {typesPresent.map((type) => (
              <FilterChip
                key={type}
                active={filter === type}
                label={TABLE_TYPE_LABELS[type]}
                count={counts.get(type) ?? 0}
                onClick={() => {
                  setFilter(type)
                }}
              />
            ))}
          </div>
        )}
        <ul
          className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1"
          aria-label="Table status legend"
        >
          {TABLE_STATUSES.map((status) => (
            <li
              key={status}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
            >
              <span
                className={`size-3 rounded-full ${TABLE_STATUS_META[status].swatch}`}
                aria-hidden
              />
              {TABLE_STATUS_META[status].label}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex-1 space-y-6 overflow-auto px-5 pb-6">
        {!canView && (
          <div className="rounded-lg border border-dashed bg-card/50 px-6 py-16 text-center">
            <p className="text-base font-semibold">Tables are not available to your role</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask a manager to give your role the Tables access.
            </p>
          </div>
        )}

        {canView && floor.isPending && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[6.5rem]" />
            ))}
          </div>
        )}

        {floor.isError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {toUserMessage(floor.error)}
          </p>
        )}

        {floor.data && allTables.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/50 px-6 py-16 text-center">
            <p className="text-base font-semibold">No tables configured yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Areas and tables are created from the admin area. Once added, they appear here with
              live status.
            </p>
            {canAdmin && canManage && (
              <Button asChild variant="outline">
                <Link to="/admin/tables">Set up tables</Link>
              </Button>
            )}
          </div>
        )}

        {visibleAreas.map((area) => (
          <section key={area.id} aria-label={area.name}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-base font-bold">{area.name}</h2>
              {area.floor && <span className="text-xs text-muted-foreground">{area.floor}</span>}
              <span className="text-xs text-muted-foreground">
                · {area.visible.filter((t) => t.status === 'AVAILABLE').length} available
              </span>
            </div>
            <FloorGrid
              tables={area.visible}
              mode="compact"
              renderTable={(table) => <TableCard table={table} now={now} onSelect={selectTable} />}
            />
          </section>
        ))}
      </div>

      <Dialog
        open={selected !== null}
        title={selected?.displayName ?? 'Table'}
        onClose={() => {
          setSelectedId(null)
        }}
      >
        {selected && (
          <TableActions
            key={selected.id}
            table={selected}
            canOperate={canOperate}
            {...(canOrder
              ? {
                  onTakeOrder: (guests: number | null) => {
                    takeOrder(selected, guests)
                  }
                }
              : {})}
            onDone={() => {
              setSelectedId(null)
            }}
            onCancel={() => {
              setSelectedId(null)
            }}
          />
        )}
      </Dialog>
    </div>
  )
}
