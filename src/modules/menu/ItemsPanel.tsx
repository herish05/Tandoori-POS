import { useMutation, useQuery } from '@tanstack/react-query'
import { ImageOff, Pencil, Plus, Power, PowerOff, Search, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { FOOD_TYPE_LABELS, FOOD_TYPES, type FoodType, type MenuItem } from '@shared/menu'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney, formatPercent } from '@/lib/money'
import { cn } from '@/lib/utils'
import { categoryService, itemService } from '@/services/menu.service'
import { FoodTypeMark } from './FoodTypeMark'
import { MENU_KEYS, useDebouncedValue, useRefreshMenu } from './hooks'
import { ItemForm } from './ItemForm'

interface ItemsPanelProps {
  canManage: boolean
  /** May mark items sold out / available again. */
  canOperate: boolean
}

/** Admin: search, filter, create, edit and retire menu items. */
export function ItemsPanel({ canManage, canOperate }: ItemsPanelProps) {
  const refresh = useRefreshMenu()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [foodType, setFoodType] = useState<'' | FoodType>('')
  const [availability, setAvailability] = useState<'' | 'AVAILABLE' | 'UNAVAILABLE'>('')
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'INACTIVE'>('')
  const [bestSellerOnly, setBestSellerOnly] = useState(false)

  const debouncedSearch = useDebouncedValue(search.trim())
  const filter = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(foodType ? { foodType } : {}),
    ...(availability ? { availability } : {}),
    ...(status ? { status } : {}),
    ...(bestSellerOnly ? { bestSellerOnly: true } : {})
  }
  const isFiltered = Object.keys(filter).length > 0 || search.trim() !== ''

  const items = useQuery({
    queryKey: MENU_KEYS.items(filter),
    queryFn: () => itemService.list(filter),
    staleTime: 0
  })
  const categories = useQuery({ queryKey: MENU_KEYS.categories, queryFn: categoryService.list })

  const [editing, setEditing] = useState<{ item: MenuItem | null } | null>(null)
  const [deleting, setDeleting] = useState<MenuItem | null>(null)
  const [notice, setNotice] = useState<string | undefined>()

  const onSuccess = async (): Promise<void> => {
    setNotice(undefined)
    await refresh()
  }
  const onError = (error: unknown): void => {
    setNotice(toUserMessage(error))
  }
  const toggleAvailability = useMutation({
    mutationFn: (item: MenuItem) =>
      itemService.setAvailability({ id: item.id, isAvailable: !item.isAvailable }),
    onSuccess,
    onError
  })
  const toggleActive = useMutation({
    mutationFn: (item: MenuItem) =>
      itemService.setActive({ id: item.id, isActive: !item.isActive }),
    onSuccess,
    onError
  })
  const remove = useMutation({
    mutationFn: (item: MenuItem) => itemService.remove(item.id),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
    }
  })

  const clearFilters = (): void => {
    setSearch('')
    setCategoryId('')
    setFoodType('')
    setAvailability('')
    setStatus('')
    setBestSellerOnly(false)
  }

  const rows = items.data
  const noCategories = categories.data?.length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          The dishes and drinks you sell. Mark an item sold out when the kitchen runs out.
        </p>
        {canManage && (
          <Button
            disabled={noCategories}
            title={noCategories ? 'Add a category first' : undefined}
            onClick={() => {
              setEditing({ item: null })
            }}
          >
            <Plus /> Add item
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3" role="search" aria-label="Filter menu items">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search items"
            placeholder="Search by name, description or category"
            className="pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>
        <Select
          aria-label="Filter by category"
          className="w-44"
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value)
          }}
        >
          <option value="">All categories</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by type"
          className="w-36"
          value={foodType}
          onChange={(event) => {
            setFoodType(event.target.value as '' | FoodType)
          }}
        >
          <option value="">All types</option>
          {FOOD_TYPES.map((type) => (
            <option key={type} value={type}>
              {FOOD_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by availability"
          className="w-40"
          value={availability}
          onChange={(event) => {
            setAvailability(event.target.value as '' | 'AVAILABLE' | 'UNAVAILABLE')
          }}
        >
          <option value="">Any availability</option>
          <option value="AVAILABLE">Available</option>
          <option value="UNAVAILABLE">Sold out</option>
        </Select>
        <Select
          aria-label="Filter by status"
          className="w-36"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as '' | 'ACTIVE' | 'INACTIVE')
          }}
        >
          <option value="">Any status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[hsl(var(--primary))]"
            checked={bestSellerOnly}
            onChange={(event) => {
              setBestSellerOnly(event.target.checked)
            }}
          />
          Best sellers
        </label>
        {isFiltered && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {notice && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          {notice}
        </p>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {items.isPending && <Skeleton className="m-5 h-40" />}
          {items.isError && (
            <p role="alert" className="p-5 text-sm text-destructive">
              {toUserMessage(items.error)}
            </p>
          )}
          {rows?.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {isFiltered
                ? 'No items match these filters.'
                : noCategories
                  ? 'Your menu is empty. Start by adding a category, then add items to it.'
                  : 'No items yet. Add your first item.'}
            </p>
          )}
          {rows && rows.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Station</th>
                  <th className="px-4 py-3">Availability</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr
                    key={item.id}
                    className={cn('border-b last:border-0', !item.isActive && 'opacity-60')}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-secondary">
                          {item.image ? (
                            <img src={item.image} alt="" className="size-full object-cover" />
                          ) : (
                            <ImageOff className="size-4 text-muted-foreground" aria-hidden />
                          )}
                        </div>
                        <div className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2 font-medium">
                            <FoodTypeMark type={item.foodType} />
                            {item.name}
                            {item.isBestSeller && (
                              <Star
                                className="size-4 fill-warning text-warning"
                                aria-label="Best seller"
                              />
                            )}
                            {item.isDemo && <Badge variant="outline">Sample</Badge>}
                          </span>
                          {item.description && (
                            <span className="block max-w-[16rem] truncate text-xs text-muted-foreground">
                              {item.description}
                            </span>
                          )}
                          {item.addons.length > 0 && (
                            <span className="block text-xs text-muted-foreground">
                              {item.addons.length} add-ons and modifiers
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{item.categoryName}</td>
                    <td className="px-4 py-3">
                      {item.variants.length === 0 ? (
                        <span className="block whitespace-nowrap">{formatMoney(item.price)}</span>
                      ) : (
                        item.variants.map((variant) => (
                          <span key={variant.id} className="block whitespace-nowrap">
                            {variant.name} {formatMoney(variant.price)}
                          </span>
                        ))
                      )}
                      {item.taxRateBps !== null && (
                        <span className="block text-xs text-muted-foreground">
                          {item.taxCategoryName} · {formatPercent(item.taxRateBps)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.effectiveStationName ?? '—'}
                      {item.stationId !== null && (
                        <span className="block text-xs">set on item</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.isAvailable}
                        aria-label={`${item.name} available to order`}
                        disabled={!canOperate || toggleAvailability.isPending}
                        onClick={() => {
                          toggleAvailability.mutate(item)
                        }}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                          item.isAvailable
                            ? 'border-transparent bg-success/15 text-success'
                            : 'border-transparent bg-warning/15 text-warning'
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'size-2 rounded-full',
                            item.isAvailable ? 'bg-success' : 'bg-warning'
                          )}
                        />
                        {item.isAvailable ? 'Available' : 'Sold out'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {item.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="destructive">Inactive</Badge>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            aria-label={`Edit ${item.name}`}
                            onClick={() => {
                              setEditing({ item })
                            }}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={item.isActive ? 'Deactivate' : 'Activate'}
                            disabled={toggleActive.isPending}
                            aria-label={`${item.isActive ? 'Deactivate' : 'Activate'} ${item.name}`}
                            onClick={() => {
                              toggleActive.mutate(item)
                            }}
                          >
                            {item.isActive ? <PowerOff /> : <Power />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            aria-label={`Delete ${item.name}`}
                            onClick={() => {
                              remove.reset()
                              setDeleting(item)
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={editing !== null}
        title={editing?.item ? 'Edit item' : 'Add item'}
        className="max-w-3xl"
        onClose={() => {
          setEditing(null)
        }}
      >
        {editing && (
          <ItemForm
            item={editing.item}
            {...(categoryId ? { defaultCategoryId: categoryId } : {})}
            onClose={() => {
              setEditing(null)
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete item"
        message={`Delete ${deleting?.name ?? 'this item'}? It disappears from the menu. Past orders that included it are not affected. To hide it temporarily, mark it sold out or deactivate it instead.`}
        confirmLabel="Delete item"
        destructive
        pending={remove.isPending}
        error={remove.isError ? toUserMessage(remove.error) : undefined}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting)
        }}
        onClose={() => {
          setDeleting(null)
        }}
      />
    </div>
  )
}
