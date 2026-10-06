import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { AddonsPanel } from '@/modules/menu/AddonsPanel'
import { CategoriesPanel } from '@/modules/menu/CategoriesPanel'
import { MENU_KEYS } from '@/modules/menu/hooks'
import { ItemsPanel } from '@/modules/menu/ItemsPanel'
import { SampleMenuCard } from '@/modules/menu/SampleMenuCard'
import { StationsPanel } from '@/modules/menu/StationsPanel'
import { TaxesPanel } from '@/modules/menu/TaxesPanel'
import { cn } from '@/lib/utils'
import { categoryService } from '@/services/menu.service'
import { usePermission } from '@/stores/auth.store'

const TABS = [
  { id: 'items', label: 'Items' },
  { id: 'categories', label: 'Categories' },
  { id: 'addons', label: 'Add-ons & modifiers' },
  { id: 'stations', label: 'Kitchen stations' },
  { id: 'taxes', label: 'Tax categories' }
] as const

type TabId = (typeof TABS)[number]['id']

/** Admin: the whole menu: items, categories, add-ons, kitchen stations and tax categories. */
export function MenuPage() {
  const canManage = usePermission('menu.manage')
  const canOperate = usePermission('menu.operate')
  const [tab, setTab] = useState<TabId>('items')
  const categories = useQuery({ queryKey: MENU_KEYS.categories, queryFn: categoryService.list })

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h2 className="text-xl font-bold">Menu</h2>
        <p className="text-sm text-muted-foreground">
          Build your menu: categories and items with variants, add-ons, kitchen stations and tax.
        </p>
      </div>

      {canManage && <SampleMenuCard menuIsEmpty={categories.data?.length === 0} />}

      <div role="tablist" aria-label="Menu setup" className="flex flex-wrap gap-1 border-b">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`menu-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="menu-tabpanel"
            onClick={() => {
              setTab(id)
            }}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
              tab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="menu-tabpanel" aria-labelledby={`menu-tab-${tab}`}>
        {tab === 'items' && <ItemsPanel canManage={canManage} canOperate={canOperate} />}
        {tab === 'categories' && <CategoriesPanel canManage={canManage} />}
        {tab === 'addons' && <AddonsPanel canManage={canManage} />}
        {tab === 'stations' && <StationsPanel canManage={canManage} />}
        {tab === 'taxes' && <TaxesPanel canManage={canManage} />}
      </div>
    </div>
  )
}
