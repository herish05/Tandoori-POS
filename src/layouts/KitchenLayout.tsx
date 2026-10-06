import { Link, Outlet } from 'react-router-dom'
import { BrandLogo } from '@/components/BrandLogo'
import { ConnectivityIndicator } from '@/components/ConnectivityIndicator'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { WindowControls } from '@/components/WindowControls'
import { UserMenu } from '@/modules/auth/UserMenu'

/** Dark, high-contrast chrome for the kitchen display (readable from a distance). */
export function KitchenLayout() {
  return (
    <div className="flex h-full flex-col bg-navy text-navy-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <div className="flex items-center gap-4">
          <Link to="/" aria-label="Tandoori-POS home">
            <BrandLogo tone="light" />
          </Link>
          <span className="rounded bg-white/10 px-2 py-1 text-xs font-bold uppercase tracking-wider">
            Kitchen display
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ConnectivityIndicator />
          <UserMenu tone="dark" />
          <WindowControls tone="dark" />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-4">
        <ErrorBoundary scope="kitchen">
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
