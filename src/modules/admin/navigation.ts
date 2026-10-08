import type { PermissionCode } from '@shared/permissions'
import {
  Banknote,
  BarChart3,
  Boxes,
  Calendar,
  ChefHat,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  type LucideIcon,
  Lock,
  Percent,
  Printer,
  Receipt,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Table2,
  Truck,
  Users,
  UsersRound,
  Wallet,
  DatabaseBackup,
  Utensils
} from 'lucide-react'

export interface AdminNavItem {
  label: string
  to: string
  icon: LucideIcon
  /** `false` = module not built yet; the route shows a "not built yet" page. */
  enabled: boolean
  /** Phase in which the section is delivered. */
  phase?: number
  /** Permission needed to see and open the section. Omit for any admin user. */
  permission?: PermissionCode
}

export interface AdminNavGroup {
  title: string
  items: AdminNavItem[]
}

/** Admin information architecture from the product specification. */
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', to: '/admin', icon: LayoutDashboard, enabled: true }]
  },
  {
    title: 'Operations',
    items: [
      { label: 'Orders', to: '/admin/orders', icon: ClipboardList, enabled: false, phase: 5 },
      {
        label: 'Tables',
        to: '/admin/tables',
        icon: Table2,
        enabled: true,
        permission: 'tables.view'
      },
      { label: 'Kitchen', to: '/admin/kitchen', icon: ChefHat, enabled: false, phase: 7 },
      {
        label: 'KOT',
        to: '/admin/kot',
        icon: FileText,
        enabled: true,
        permission: 'orders.view'
      },
      {
        label: 'Bills',
        to: '/admin/bills',
        icon: Receipt,
        enabled: true,
        permission: 'billing.view'
      },
      {
        label: 'Reservations',
        to: '/admin/reservations',
        icon: Calendar,
        enabled: true,
        permission: 'reservations.view'
      },
      {
        label: 'Customers',
        to: '/admin/customers',
        icon: Users,
        enabled: true,
        permission: 'customers.view'
      }
    ]
  },
  {
    title: 'Menu',
    items: [
      {
        label: 'Menu',
        to: '/admin/menu',
        icon: Utensils,
        enabled: true,
        permission: 'menu.view'
      }
    ]
  },
  {
    title: 'Stock & Finance',
    items: [
      {
        label: 'Inventory',
        to: '/admin/inventory',
        icon: Boxes,
        enabled: true,
        permission: 'inventory.view'
      },
      {
        label: 'Purchases',
        to: '/admin/purchases',
        icon: ShoppingCart,
        enabled: true,
        permission: 'purchases.view'
      },
      {
        label: 'Suppliers',
        to: '/admin/suppliers',
        icon: Truck,
        enabled: true,
        permission: 'suppliers.view'
      },
      {
        label: 'Expenses',
        to: '/admin/expenses',
        icon: Wallet,
        enabled: true,
        permission: 'expenses.view'
      },
      {
        label: 'Cash drawer',
        to: '/admin/cash',
        icon: Banknote,
        enabled: true,
        permission: 'cash.view'
      },
      {
        label: 'Day closing',
        to: '/admin/day-closing',
        icon: Lock,
        enabled: true,
        permission: 'day.view'
      },
      {
        label: 'Reports',
        to: '/admin/reports',
        icon: BarChart3,
        enabled: true,
        permission: 'reports.view'
      }
    ]
  },
  {
    title: 'Configuration',
    items: [
      {
        label: 'Staff',
        to: '/admin/staff',
        icon: UsersRound,
        enabled: true,
        permission: 'users.view'
      },
      {
        label: 'Roles',
        to: '/admin/roles',
        icon: ShieldCheck,
        enabled: true,
        permission: 'roles.view'
      },
      {
        label: 'Billing settings',
        to: '/admin/billing-settings',
        icon: Percent,
        enabled: true,
        permission: 'billing.view'
      },
      {
        label: 'Printers',
        to: '/admin/printers',
        icon: Printer,
        enabled: true,
        permission: 'printers.view'
      },
      {
        label: 'Restaurant settings',
        to: '/admin/settings',
        icon: Settings,
        enabled: true,
        permission: 'restaurant.view'
      },
      { label: 'Backup', to: '/admin/backup', icon: DatabaseBackup, enabled: false, phase: 21 },
      { label: 'Sync', to: '/admin/sync', icon: RefreshCw, enabled: false, phase: 19 },
      {
        label: 'Audit logs',
        to: '/admin/audit-logs',
        icon: History,
        enabled: true,
        permission: 'audit.view'
      }
    ]
  }
]
