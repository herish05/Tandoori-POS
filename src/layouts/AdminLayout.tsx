import { ChevronsLeft, ChevronsRight, LayoutGrid } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { BrandLogo } from '@/components/BrandLogo'
import { ConnectivityIndicator } from '@/components/ConnectivityIndicator'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { WindowControls } from '@/components/WindowControls'
import { cn } from '@/lib/utils'
import { UserMenu } from '@/modules/auth/UserMenu'
import { ADMIN_NAV } from '@/modules/admin/navigation'
import { hasPermission, useAuthStore, usePermission } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

export function AdminLayout() {
  const collapsed = useUiStore((s) => s.adminSidebarCollapsed)
  const toggle = useUiStore((s) => s.toggleAdminSidebar)
  const session = useAuthStore((s) => s.session)
  const canUsePos = usePermission('pos.access')
  const groups = ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || hasPermission(session, item.permission))
  })).filter((group) => group.items.length > 0)

  return (
    <div className="flex h-full bg-background">
      <aside
        className={cn(
          'flex shrink-0 flex-col bg-navy text-navy-foreground transition-[width] duration-100',
          collapsed ? 'w-16' : 'w-64'
        )}
        aria-label="Admin navigation"
      >
        <div className="flex h-16 items-center justify-between px-3">
          <BrandLogo tone="light" showWordmark={!collapsed} />
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {canUsePos && (
            <Link
              to="/pos"
              title="Back to POS tables"
              className="mt-3 flex h-10 items-center gap-3 rounded-md bg-white/10 px-3 text-sm font-semibold hover:bg-white/20"
            >
              <LayoutGrid className="size-4 shrink-0" aria-hidden />
              {!collapsed && 'Back to POS'}
            </Link>
          )}
          {groups.map((group) => (
            <div key={group.title} className="mt-3">
              {!collapsed && (
                <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-navy-foreground/50">
                  {group.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map(({ label, to, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end
                      title={label}
                      className={({ isActive }) =>
                        cn(
                          'flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium',
                          isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-white/10'
                        )
                      }
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {!collapsed && label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <Button
          variant="ghost"
          className="m-2 justify-start text-navy-foreground hover:bg-white/10 hover:text-white"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          {!collapsed && 'Collapse'}
        </Button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-5">
          <h1 className="text-lg font-bold">Admin</h1>
          <div className="flex items-center gap-2">
            {canUsePos && (
              <Button asChild className="h-10 px-4">
                <Link to="/pos">
                  <LayoutGrid /> Back to POS
                </Link>
              </Button>
            )}
            <ConnectivityIndicator />
            <UserMenu />
            <WindowControls />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          <ErrorBoundary scope="admin">
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
