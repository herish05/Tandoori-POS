import type { PermissionCode } from '@shared/permissions'
import {
  BarChart3,
  Boxes,
  Calendar,
  ChefHat,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  type LucideIcon,
  Percent,
  Printer,
  Receipt,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Table2,
  Tag,
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
      { label: 'KOT', to: '/admin/kot', icon: FileText, enabled: false, phase: 6 },
      { label: 'Bills', to: '/admin/bills', icon: Receipt, enabled: false, phase: 8 },
      {
        label: 'Reservations',
        to: '/admin/reservations',
        icon: Calendar,
        enabled: false,
        phase: 12
      },
      { label: 'Customers', to: '/admin/customers', icon: Users, enabled: false, phase: 12 }
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
      { label: 'Inventory', to: '/admin/inventory', icon: Boxes, enabled: false, phase: 13 },
      { label: 'Purchases', to: '/admin/purchases', icon: ShoppingCart, enabled: false, phase: 14 },
      { label: 'Suppliers', to: '/admin/suppliers', icon: Truck, enabled: false, phase: 14 },
      { label: 'Expenses', to: '/admin/expenses', icon: Wallet, enabled: false, phase: 15 },
      { label: 'Reports', to: '/admin/reports', icon: BarChart3, enabled: false, phase: 17 }
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
      { label: 'Taxes', to: '/admin/taxes', icon: Percent, enabled: false, phase: 8 },
      { label: 'Discounts', to: '/admin/discounts', icon: Tag, enabled: false, phase: 8 },
      { label: 'Printers', to: '/admin/printers', icon: Printer, enabled: false, phase: 18 },
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
