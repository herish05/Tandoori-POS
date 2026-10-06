import { useState } from 'react'
import { AreasPanel } from '@/modules/tables/admin/AreasPanel'
import { LayoutEditor } from '@/modules/tables/admin/LayoutEditor'
import { TablesPanel } from '@/modules/tables/admin/TablesPanel'
import { cn } from '@/lib/utils'
import { usePermission } from '@/stores/auth.store'

const TABS = [
  { id: 'areas', label: 'Areas' },
  { id: 'tables', label: 'Tables' },
  { id: 'layout', label: 'Layout' }
] as const

type TabId = (typeof TABS)[number]['id']

/** Admin: areas, tables and the floor-plan layout. */
export function TablesPage() {
  const canManage = usePermission('tables.manage')
  const [tab, setTab] = useState<TabId>('areas')

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h2 className="text-xl font-bold">Tables</h2>
        <p className="text-sm text-muted-foreground">
          Set up dining areas and tables, and arrange how they appear on the POS floor.
        </p>
      </div>

      <div role="tablist" aria-label="Table setup" className="flex gap-1 border-b">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tables-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="tables-tabpanel"
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

      <div role="tabpanel" id="tables-tabpanel" aria-labelledby={`tables-tab-${tab}`}>
        {tab === 'areas' && <AreasPanel canManage={canManage} />}
        {tab === 'tables' && <TablesPanel canManage={canManage} />}
        {tab === 'layout' && <LayoutEditor canManage={canManage} />}
      </div>
    </div>
  )
}
