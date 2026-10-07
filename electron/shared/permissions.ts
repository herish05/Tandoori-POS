/**
 * Permission catalogue. This is the single source of truth: the main process syncs it into the
 * `permissions` table at startup and the renderer uses it to render role editors and guards.
 * Later phases append their own permissions here (the OWNER role is granted every permission
 * automatically on the next start).
 */
export const PERMISSION_CODES = [
  'pos.access',
  'kitchen.access',
  'admin.access',
  'restaurant.view',
  'restaurant.manage',
  'users.view',
  'users.manage',
  'roles.view',
  'roles.manage',
  'audit.view',
  'tables.view',
  'tables.manage',
  'tables.operate',
  'tables.transfer',
  'menu.view',
  'menu.manage',
  'menu.operate',
  'orders.view',
  'orders.operate',
  'orders.cancel',
  'kitchen.operate',
  'printers.view',
  'printers.manage',
  'billing.view',
  'billing.operate',
  'billing.discount',
  'billing.refund',
  'billing.manage'
] as const

export type PermissionCode = (typeof PERMISSION_CODES)[number]

export interface PermissionMeta {
  label: string
  group: string
  description: string
}

export const PERMISSION_META: Record<PermissionCode, PermissionMeta> = {
  'pos.access': {
    label: 'Open the POS',
    group: 'Screens',
    description: 'Use the table view and order screens.'
  },
  'kitchen.access': {
    label: 'Open the kitchen display',
    group: 'Screens',
    description: 'See and update tickets on the kitchen screen.'
  },
  'admin.access': {
    label: 'Open the admin area',
    group: 'Screens',
    description: 'Enter the back-office area. Each section also needs its own permission.'
  },
  'restaurant.view': {
    label: 'View restaurant settings',
    group: 'Restaurant',
    description: 'See the restaurant profile.'
  },
  'restaurant.manage': {
    label: 'Edit restaurant settings',
    group: 'Restaurant',
    description: 'Change the restaurant profile, tax number and receipt footer.'
  },
  'users.view': {
    label: 'View staff',
    group: 'Staff',
    description: 'See the staff list.'
  },
  'users.manage': {
    label: 'Manage staff',
    group: 'Staff',
    description: 'Add staff, change their roles, reset passwords and deactivate accounts.'
  },
  'roles.view': {
    label: 'View roles',
    group: 'Roles',
    description: 'See roles and what they allow.'
  },
  'roles.manage': {
    label: 'Manage roles',
    group: 'Roles',
    description: 'Create, edit and delete roles.'
  },
  'audit.view': {
    label: 'View audit logs',
    group: 'Security',
    description: 'See who signed in and who changed what.'
  },
  'tables.view': {
    label: 'View tables',
    group: 'Tables',
    description: 'See areas, tables and their live status.'
  },
  'tables.manage': {
    label: 'Manage areas and tables',
    group: 'Tables',
    description: 'Add, edit, deactivate and arrange areas and tables.'
  },
  'tables.operate': {
    label: 'Open and close tables',
    group: 'Tables',
    description: 'Open a table for guests, close it, and block or unblock it.'
  },
  'tables.transfer': {
    label: 'Shift and merge tables',
    group: 'Tables',
    description: 'Move a running order to another table, or merge two running tables into one.'
  },
  'menu.view': {
    label: 'View the menu',
    group: 'Menu',
    description: 'See categories, items, prices, add-ons, kitchen stations and tax categories.'
  },
  'menu.manage': {
    label: 'Manage the menu',
    group: 'Menu',
    description:
      'Add, edit, deactivate and delete menu items, categories, add-ons, stations and taxes.'
  },
  'menu.operate': {
    label: 'Mark items sold out',
    group: 'Menu',
    description: 'Switch menu items between available and sold out during service.'
  },
  'orders.view': {
    label: 'View orders',
    group: 'Orders',
    description: 'See orders, their items and their status.'
  },
  'orders.operate': {
    label: 'Take orders',
    group: 'Orders',
    description:
      'Create orders, add or remove items, send them to the kitchen and update their status.'
  },
  'orders.cancel': {
    label: 'Cancel orders and items',
    group: 'Orders',
    description: 'Cancel an order, or an item that was already sent to the kitchen.'
  },
  'kitchen.operate': {
    label: 'Work the kitchen tickets',
    group: 'Kitchen',
    description: 'Accept, start, finish and serve kitchen tickets.'
  },
  'printers.view': {
    label: 'View printers',
    group: 'Printing',
    description: 'See the printers set up for kitchen tickets.'
  },
  'printers.manage': {
    label: 'Manage printers',
    group: 'Printing',
    description: 'Add, edit and remove printers, and print a test page.'
  },
  'billing.view': {
    label: 'View bills',
    group: 'Billing',
    description: 'See bills, their totals, taxes and payments.'
  },
  'billing.operate': {
    label: 'Bill and take payment',
    group: 'Billing',
    description: 'Make a bill from an order, record payments, and cancel an unpaid bill.'
  },
  'billing.discount': {
    label: 'Give discounts',
    group: 'Billing',
    description: 'Apply a discount to a bill or to an item on it, and remove one again.'
  },
  'billing.refund': {
    label: 'Give refunds',
    group: 'Billing',
    description: 'Return money on a paid bill, in full or in part.'
  },
  'billing.manage': {
    label: 'Manage billing settings',
    group: 'Billing',
    description: 'Change the GST split, service charge and round off used on new bills.'
  }
}

/**
 * Permissions that a stronger permission includes besides its "view" counterpart: whoever
 * can manage the menu can obviously also mark items sold out.
 */
export const ALSO_IMPLIED: Partial<Record<PermissionCode, readonly PermissionCode[]>> = {
  'menu.manage': ['menu.operate'],
  'orders.cancel': ['orders.operate', 'orders.view'],
  'tables.transfer': ['tables.view', 'orders.view'],
  'kitchen.operate': ['kitchen.access'],
  'billing.discount': ['billing.operate', 'billing.view'],
  'billing.refund': ['billing.view']
}

export const OWNER_ROLE_NAME = 'OWNER'

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSION_CODES as readonly string[]).includes(value)
}

/** A "manage" or "operate" permission is useless without its "view" counterpart, so it implies it. */
export function withImpliedPermissions(codes: readonly PermissionCode[]): PermissionCode[] {
  const result = new Set<PermissionCode>(codes)
  for (const code of codes) {
    if (code.endsWith('.manage') || code.endsWith('.operate')) {
      const view = code.replace(/\.(manage|operate)$/, '.view')
      if (isPermissionCode(view)) result.add(view)
    }
    for (const extra of ALSO_IMPLIED[code] ?? []) result.add(extra)
  }
  return PERMISSION_CODES.filter((code) => result.has(code))
}
