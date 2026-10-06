import type { ReactNode } from 'react'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import { AdminLayout } from '@/layouts/AdminLayout'
import { ADMIN_NAV } from '@/modules/admin/navigation'
import { RequireAuth } from '@/modules/auth/RequireAuth'
import { AccountPage } from '@/pages/AccountPage'
import { AuditLogsPage } from '@/pages/AuditLogsPage'
import { MenuPage } from '@/pages/MenuPage'
import { OrderPage } from '@/pages/OrderPage'
import { RestaurantSettingsPage } from '@/pages/RestaurantSettingsPage'
import { RolesPage } from '@/pages/RolesPage'
import { SetupPage } from '@/pages/SetupPage'
import { StaffPage } from '@/pages/StaffPage'
import { TablesPage } from '@/pages/TablesPage'
import { AdminSectionPage } from '@/pages/AdminSectionPage'
import { KitchenLayout } from '@/layouts/KitchenLayout'
import { PosLayout } from '@/layouts/PosLayout'
import { RootLayout } from '@/layouts/RootLayout'
import { AdminDashboardPage } from '@/pages/AdminDashboardPage'
import { NotFoundPage, RouteErrorPage } from '@/pages/ErrorPages'
import { KitchenPage } from '@/pages/KitchenPage'
import { LoginPage } from '@/pages/LoginPage'
import { PosPage } from '@/pages/PosPage'
import { StartupPage } from '@/pages/StartupPage'

/** Screens that exist for admin sections marked `enabled`; the rest show a "not built yet" page. */
const ADMIN_PAGES: Record<string, ReactNode> = {
  '/admin/menu': <MenuPage />,
  '/admin/tables': <TablesPage />,
  '/admin/staff': <StaffPage />,
  '/admin/roles': <RolesPage />,
  '/admin/settings': <RestaurantSettingsPage />,
  '/admin/audit-logs': <AuditLogsPage />
}

const adminRoutes = ADMIN_NAV.flatMap((group) => group.items)
  .filter((item) => item.to !== '/admin')
  .map((item) => ({
    path: item.to.replace('/admin/', ''),
    element: (
      <RequireAuth {...(item.permission ? { permission: item.permission } : {})}>
        {ADMIN_PAGES[item.to] ?? <AdminSectionPage />}
      </RequireAuth>
    )
  }))

/** Hash routing: works under both the dev server and the packaged `app://` protocol. */
const router = createHashRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <StartupPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'setup', element: <SetupPage /> },
      {
        path: 'account',
        element: (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        )
      },
      {
        path: 'pos',
        element: (
          <RequireAuth permission="pos.access">
            <PosLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <PosPage /> },
          {
            path: 'orders/new',
            element: (
              <RequireAuth permission="orders.operate">
                <OrderPage />
              </RequireAuth>
            )
          },
          {
            path: 'orders/:orderId',
            element: (
              <RequireAuth permission="orders.view">
                <OrderPage />
              </RequireAuth>
            )
          }
        ]
      },
      {
        path: 'admin',
        element: (
          <RequireAuth permission="admin.access">
            <AdminLayout />
          </RequireAuth>
        ),
        children: [{ index: true, element: <AdminDashboardPage /> }, ...adminRoutes]
      },
      {
        path: 'kitchen',
        element: (
          <RequireAuth permission="kitchen.access">
            <KitchenLayout />
          </RequireAuth>
        ),
        children: [{ index: true, element: <KitchenPage /> }]
      },
      { path: '*', element: <NotFoundPage /> }
    ]
  }
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
