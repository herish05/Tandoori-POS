import { useLocation } from 'react-router-dom'
import { ADMIN_NAV } from '@/modules/admin/navigation'

const ALL_ITEMS = ADMIN_NAV.flatMap((group) => group.items)

/** Shown for admin sections whose module has not been built yet. */
export function AdminSectionPage() {
  const { pathname } = useLocation()
  const item = ALL_ITEMS.find((i) => i.to === pathname)
  const Icon = item?.icon

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-lg border border-dashed bg-card/50 px-6 py-16 text-center">
      {Icon && <Icon className="size-10 text-muted-foreground" aria-hidden />}
      <h2 className="text-xl font-bold">{item?.label ?? 'Section'}</h2>
      <p className="text-sm text-muted-foreground">
        This section is not built yet
        {item?.phase ? ` and is delivered in Phase ${String(item.phase)}` : ''}.
      </p>
    </div>
  )
}
