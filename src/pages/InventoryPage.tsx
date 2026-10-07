import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import {
  MOVEMENT_TYPES,
  MOVEMENT_TYPE_LABELS,
  UNIT_LABELS,
  formatQuantity,
  type InventoryItem,
  type MovementType
} from '@shared/inventory'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { INVENTORY_KEYS, useRefreshInventory } from '@/modules/inventory/hooks'
import { ItemFormDialog } from '@/modules/inventory/ItemFormDialog'
import { RecipeEditor } from '@/modules/inventory/RecipeEditor'
import { StockActionDialog, type StockAction } from '@/modules/inventory/StockActionDialog'
import { useDebouncedValue } from '@/modules/menu/hooks'
import { inventoryService, recipeService } from '@/services/inventory.service'
import { usePermission } from '@/stores/auth.store'

type Tab = 'stock' | 'movements' | 'recipes'

const TABS: { id: Tab; label: string }[] = [
  { id: 'stock', label: 'Stock' },
  { id: 'movements', label: 'Movements' },
  { id: 'recipes', label: 'Recipes' }
]

/** Admin: raw-material stock, the ledger of every change to it, and the recipes that use it. */
export function InventoryPage() {
  const [tab, setTab] = useState<Tab>('stock')
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h2 className="text-xl font-bold">Inventory</h2>
        <p className="text-sm text-muted-foreground">
          Raw materials, what has been used or wasted, and how much of each a dish needs. Stock is
          taken out when an order is sent to the kitchen.
        </p>
      </div>
      <div role="tablist" aria-label="Inventory" className="flex gap-1 border-b">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => {
              setTab(entry.id)
            }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === entry.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {tab === 'stock' && <StockTab />}
      {tab === 'movements' && <MovementsTab />}
      {tab === 'recipes' && <RecipesTab />}
    </div>
  )
}

function StockTab() {
  const canManage = usePermission('inventory.manage')
  const canOperate = usePermission('inventory.operate')
  const refresh = useRefreshInventory()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim())
  const [lowOnly, setLowOnly] = useState(false)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [form, setForm] = useState<'closed' | 'new' | InventoryItem>('closed')
  const [action, setAction] = useState<{ kind: StockAction; item: InventoryItem } | null>(null)
  const [removing, setRemoving] = useState<InventoryItem | null>(null)

  const filter = {
    ...(debounced ? { search: debounced } : {}),
    ...(lowOnly ? { lowOnly: true } : {}),
    ...(includeInactive ? { includeInactive: true } : {})
  }
  const summary = useQuery({
    queryKey: INVENTORY_KEYS.summary,
    queryFn: inventoryService.summary,
    staleTime: 0
  })
  const items = useQuery({
    queryKey: INVENTORY_KEYS.list(filter),
    queryFn: () => inventoryService.list(filter),
    staleTime: 0
  })
  const toggle = useMutation({
    mutationFn: inventoryService.setActive,
    onSuccess: refresh
  })
  const remove = useMutation({
    mutationFn: inventoryService.remove,
    onSuccess: async () => {
      await refresh()
      setRemoving(null)
    }
  })

  return (
    <div className="space-y-4">
      {summary.isSuccess && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="inventory-summary">
          <SummaryCard label="Items" value={String(summary.data.activeItems)} />
          <SummaryCard
            label="Running low"
            value={String(summary.data.lowItems)}
            warn={summary.data.lowItems > 0}
          />
          <SummaryCard
            label="Out of stock"
            value={String(summary.data.outOfStockItems)}
            warn={summary.data.outOfStockItems > 0}
          />
          <SummaryCard label="Stock value" value={formatMoney(summary.data.stockValue)} />
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block space-y-1 text-xs font-medium">
            Search
            <Input
              className="w-64"
              placeholder="Name or category"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
              }}
            />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(event) => {
                setLowOnly(event.target.checked)
              }}
            />
            Low stock only
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked)
              }}
            />
            Show retired items
          </label>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setForm('new')
            }}
          >
            <Plus /> Add item
          </Button>
        )}
      </div>

      {items.isPending && <Skeleton className="h-64 w-full" />}
      {items.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(items.error)}
        </p>
      )}
      {toggle.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(toggle.error)}
        </p>
      )}
      {items.isSuccess && items.data.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {debounced || lowOnly
            ? 'No stock item matches.'
            : 'No stock items yet. Add the raw materials your kitchen uses.'}
        </div>
      )}
      {items.isSuccess && items.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm" data-testid="inventory-table">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">On hand</th>
                <th className="px-3 py-2 text-right">Reorder at</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.data.map((item) => {
                const unit = UNIT_LABELS[item.unit]
                return (
                  <tr key={item.id} className="hover:bg-accent/50">
                    <td className="px-3 py-2">
                      <div className="font-medium">{item.name}</div>
                      {item.category && (
                        <div className="text-xs text-muted-foreground">{item.category}</div>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-medium ${item.onHand <= 0 ? 'text-destructive' : ''}`}
                    >
                      {formatQuantity(item.onHand)} {unit}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {item.reorderLevel > 0 ? `${formatQuantity(item.reorderLevel)} ${unit}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {item.unitCost > 0 ? `${formatMoney(item.unitCost)} / ${unit}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">{formatMoney(item.stockValue)}</td>
                    <td className="px-3 py-2">
                      {!item.isActive ? (
                        <Badge variant="secondary">Retired</Badge>
                      ) : item.onHand <= 0 ? (
                        <Badge variant="destructive">Out</Badge>
                      ) : item.isLow ? (
                        <Badge variant="warning">Low</Badge>
                      ) : (
                        <Badge variant="success">OK</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        {canOperate && item.isActive && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setAction({ kind: 'STOCK_IN', item })
                              }}
                            >
                              Stock in
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setAction({ kind: 'WASTAGE', item })
                              }}
                            >
                              Wastage
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setAction({ kind: 'COUNT', item })
                              }}
                            >
                              Count
                            </Button>
                          </>
                        )}
                        {canManage && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setForm(item)
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={toggle.isPending}
                              onClick={() => {
                                toggle.mutate({ id: item.id, isActive: !item.isActive })
                              }}
                            >
                              {item.isActive ? 'Retire' : 'Restore'}
                            </Button>
                            {item.lastMovementAt === null && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  remove.reset()
                                  setRemoving(item)
                                }}
                              >
                                Delete
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ItemFormDialog
        open={form !== 'closed'}
        item={form === 'closed' || form === 'new' ? null : form}
        onClose={() => {
          setForm('closed')
        }}
      />
      <StockActionDialog
        open={action !== null}
        action={action?.kind ?? 'STOCK_IN'}
        item={action?.item ?? null}
        onClose={() => {
          setAction(null)
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Delete stock item"
        message={`Delete ${removing?.name ?? 'this item'}? Items that have any stock history cannot be deleted; retire them instead.`}
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        error={remove.isError ? toUserMessage(remove.error) : undefined}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id)
        }}
        onClose={() => {
          setRemoving(null)
        }}
      />
    </div>
  )
}

function SummaryCard({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${warn ? 'text-warning' : ''}`}>{value}</div>
    </div>
  )
}

function MovementsTab() {
  const [itemId, setItemId] = useState('')
  const [type, setType] = useState<MovementType | ''>('')
  const items = useQuery({
    queryKey: INVENTORY_KEYS.list({ includeInactive: true }),
    queryFn: () => inventoryService.list({ includeInactive: true }),
    staleTime: 0
  })
  const filter = {
    ...(itemId ? { itemId } : {}),
    ...(type ? { types: [type] } : {}),
    limit: 300
  }
  const movements = useQuery({
    queryKey: INVENTORY_KEYS.movements(filter),
    queryFn: () => inventoryService.movements(filter),
    staleTime: 0
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1 text-xs font-medium">
          Item
          <Select
            className="w-56"
            value={itemId}
            onChange={(event) => {
              setItemId(event.target.value)
            }}
          >
            <option value="">All items</option>
            {(items.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-xs font-medium">
          Kind
          <Select
            className="w-52"
            value={type}
            onChange={(event) => {
              setType(event.target.value as MovementType | '')
            }}
          >
            <option value="">All kinds</option>
            {MOVEMENT_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {MOVEMENT_TYPE_LABELS[entry]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {movements.isPending && <Skeleton className="h-64 w-full" />}
      {movements.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(movements.error)}
        </p>
      )}
      {movements.isSuccess && movements.data.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nothing has been recorded yet.
        </div>
      )}
      {movements.isSuccess && movements.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm" data-testid="movements-table">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2 text-right">Change</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">By</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {movements.data.map((row) => {
                const unit = UNIT_LABELS[row.unit]
                return (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-medium">{row.itemName}</td>
                    <td className="px-3 py-2">{MOVEMENT_TYPE_LABELS[row.type]}</td>
                    <td
                      className={`px-3 py-2 text-right font-medium ${row.quantity < 0 ? 'text-destructive' : 'text-success'}`}
                    >
                      {row.quantity > 0 ? '+' : ''}
                      {formatQuantity(row.quantity)} {unit}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatQuantity(row.balanceAfter)} {unit}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.orderNumber ?? row.reason ?? ''}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.createdBy ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RecipesTab() {
  const canManage = usePermission('inventory.manage')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const coverage = useQuery({
    queryKey: INVENTORY_KEYS.coverage,
    queryFn: recipeService.coverage,
    staleTime: 0
  })

  const term = search.trim().toLowerCase()
  const rows = (coverage.data ?? []).filter(
    (row) =>
      row.isActive &&
      (term === '' ||
        row.itemName.toLowerCase().includes(term) ||
        row.categoryName.toLowerCase().includes(term))
  )

  return (
    <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
      <div className="space-y-2">
        <Input
          placeholder="Search menu items"
          aria-label="Search menu items"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
          }}
        />
        {coverage.isPending && <Skeleton className="h-48 w-full" />}
        {coverage.isError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {toUserMessage(coverage.error)}
          </p>
        )}
        {coverage.isSuccess && rows.length === 0 && (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No menu items to show.
          </p>
        )}
        <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border bg-card">
          {rows.map((row) => (
            <li key={row.menuItemId}>
              <button
                type="button"
                onClick={() => {
                  setSelected(row.menuItemId)
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
                  selected === row.menuItemId ? 'bg-accent' : ''
                }`}
              >
                <span>
                  <span className="block font-medium">{row.itemName}</span>
                  <span className="block text-xs text-muted-foreground">{row.categoryName}</span>
                </span>
                {row.lineCount > 0 ? (
                  <Badge variant="success">{row.lineCount}</Badge>
                ) : (
                  <Badge variant="outline">None</Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border bg-card p-4">
        {selected ? (
          <RecipeEditor key={selected} menuItemId={selected} canManage={canManage} />
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Choose a menu item to see or set what it uses.
          </p>
        )}
      </div>
    </div>
  )
}
