import {
  Bell,
  CircleHelp,
  LayoutGrid,
  Menu,
  PauseCircle,
  Search,
  Settings,
  Store
} from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'
import { BrandLogo } from '@/components/BrandLogo'
import { ConnectivityIndicator } from '@/components/ConnectivityIndicator'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WindowControls } from '@/components/WindowControls'
import { UserMenu } from '@/modules/auth/UserMenu'
import { usePermission } from '@/stores/auth.store'

const QUICK_ACTIONS = [
  { label: 'Store status', icon: Store },
  { label: 'Live view', icon: LayoutGrid },
  { label: 'Hold orders', icon: PauseCircle },
  { label: 'Help', icon: CircleHelp },
  { label: 'Alerts', icon: Bell }
] as const

/** POS chrome: header with order actions, bill search and system status. */
export function PosLayout() {
  const canAdmin = usePermission('admin.access')
  const canOrder = usePermission('orders.operate')
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-card px-3 shadow-sm">
        <Button variant="ghost" size="icon" disabled aria-label="Menu">
          <Menu />
        </Button>
        <Link to="/" aria-label="Tandoori-POS home">
          <BrandLogo />
        </Link>
        <Button asChild={canOrder} disabled={!canOrder} className="ml-2 h-10 px-5">
          {canOrder ? <Link to="/pos">New Order</Link> : 'New Order'}
        </Button>
        <div className="relative w-44">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input disabled placeholder="Bill no" className="pl-8" aria-label="Search bill number" />
        </div>

        <nav className="ml-auto flex items-center gap-1" aria-label="Quick actions">
          {QUICK_ACTIONS.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              disabled
              className="flex h-12 w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-md text-[11px] font-medium text-muted-foreground disabled:opacity-60"
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </button>
          ))}
          {canAdmin && (
            <Link
              to="/admin"
              className="flex h-12 w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-md text-[11px] font-medium text-foreground hover:bg-secondary"
            >
              <Settings className="size-5" aria-hidden />
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2 border-l pl-3">
          <ConnectivityIndicator />
          <UserMenu />
          <WindowControls />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        <ErrorBoundary scope="pos">
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
