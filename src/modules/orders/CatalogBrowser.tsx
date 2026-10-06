import { Search, Star } from 'lucide-react'
import { useState } from 'react'
import type { PosCatalog, PosItem } from '@shared/orders'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { FoodTypeMark } from '@/modules/menu/FoodTypeMark'

interface CatalogBrowserProps {
  catalog: PosCatalog
  onPick: (item: PosItem) => void
}

const ALL = 'ALL'

function priceLabel(item: PosItem): string {
  const prices = item.variants.filter((v) => v.isAvailable).map((v) => v.price)
  if (prices.length > 1) return `From ${formatMoney(Math.min(...prices))}`
  return formatMoney(prices[0] ?? item.price)
}

/** Category tabs, a search box and a grid of item tiles. Picking a tile opens the item dialog. */
export function CatalogBrowser({ catalog, onPick }: CatalogBrowserProps) {
  const [category, setCategory] = useState<string>(ALL)
  const [search, setSearch] = useState('')

  const term = search.trim().toLowerCase()
  const items = catalog.items.filter((item) => {
    if (term !== '') return item.name.toLowerCase().includes(term)
    return category === ALL || item.categoryId === category
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b bg-card px-4 py-3">
        <div className="relative max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-8"
            placeholder="Search items"
            aria-label="Search items"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>
        <div
          className="flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Menu categories"
        >
          {[{ id: ALL, name: 'All', itemCount: catalog.items.length }, ...catalog.categories].map(
            (entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={term === '' && category === entry.id}
                onClick={() => {
                  setCategory(entry.id)
                  setSearch('')
                }}
                className={cn(
                  'shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors',
                  term === '' && category === entry.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-accent'
                )}
              >
                {entry.name}
              </button>
            )
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {catalog.items.length === 0
              ? 'There are no menu items yet. Add them from the admin area.'
              : 'No items match.'}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!item.isAvailable}
                  onClick={() => {
                    onPick(item)
                  }}
                  data-item-name={item.name}
                  className={cn(
                    'flex h-full min-h-[5.5rem] w-full flex-col justify-between gap-2 rounded-lg border bg-card p-3 text-left shadow-sm transition',
                    'hover:border-primary hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    !item.isAvailable &&
                      'cursor-not-allowed opacity-50 hover:border-border hover:shadow-sm'
                  )}
                >
                  <span className="flex items-start gap-2">
                    <FoodTypeMark type={item.foodType} className="mt-0.5" />
                    <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">
                      {item.name}
                    </span>
                    {item.isBestSeller && (
                      <Star
                        className="size-4 shrink-0 fill-warning text-warning"
                        aria-label="Best seller"
                      />
                    )}
                  </span>
                  <span className="flex items-center justify-between text-sm">
                    <span className="font-bold">{priceLabel(item)}</span>
                    {!item.isAvailable && (
                      <span className="text-xs font-semibold text-destructive">Sold out</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
