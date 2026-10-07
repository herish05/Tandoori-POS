import { AuditService } from './auth/audit-service'
import { AuthService, type AuthOptions } from './auth/auth-service'
import { syncPermissionCatalog } from './auth/permission-catalog'
import { RoleService } from './auth/role-service'
import type { Clock } from './auth/types'
import { UserService } from './auth/user-service'
import type { AppDatabase } from './db/client'
import type { Logger } from './logging/log-manager'
import { AddonService } from './menu/addon-service'
import { CategoryService } from './menu/category-service'
import { DemoMenuService } from './menu/demo-service'
import { ItemService } from './menu/item-service'
import { StationService } from './menu/station-service'
import { TaxCategoryService } from './menu/tax-service'
import { BillService } from './billing/bill-service'
import { BillingSettingsService } from './billing/settings-service'
import { CustomerService } from './customers/customer-service'
import { InventoryService } from './inventory/inventory-service'
import { RecipeService } from './inventory/recipe-service'
import { ReservationService } from './reservations/reservation-service'
import { KotService } from './kitchen/kot-service'
import { NetworkPrinterDriver, type PrinterDrivers } from './printing/drivers'
import { PrinterService } from './printing/printer-service'
import { PrintService } from './printing/print-service'
import { ReceiptService } from './printing/receipt-service'
import { OrderCatalogService } from './orders/catalog-service'
import { OrderService } from './orders/order-service'
import { RestaurantService } from './restaurant/restaurant-service'
import { SetupService } from './setup/setup-service'
import { AreaService } from './tables/area-service'
import { TableOperationService } from './tables/table-ops-service'
import { TableService } from './tables/table-service'

export interface Services {
  audit: AuditService
  auth: AuthService
  setup: SetupService
  restaurant: RestaurantService
  users: UserService
  roles: RoleService
  areas: AreaService
  tables: TableService
  tableOps: TableOperationService
  stations: StationService
  categories: CategoryService
  taxCategories: TaxCategoryService
  addons: AddonService
  items: ItemService
  demoMenu: DemoMenuService
  orders: OrderService
  kots: KotService
  printers: PrinterService
  print: PrintService
  orderCatalog: OrderCatalogService
  billingSettings: BillingSettingsService
  bills: BillService
  receipts: ReceiptService
  customers: CustomerService
  reservations: ReservationService
  inventory: InventoryService
  recipes: RecipeService
}

export interface ServiceDeps {
  db: AppDatabase
  deviceId: string | null
  logger: Logger
  securityLogger: Logger
  clock?: Clock
  authOptions?: Partial<AuthOptions>
  /** Whether the sample menu may be loaded. Off unless the caller (non-production builds) opts in. */
  allowDemoData?: boolean
  /** Printer drivers by kind; the network driver is built in, the system one comes from Electron. */
  printDrivers?: PrinterDrivers
}

/** Builds the business services over one database connection. */
export function createServices(deps: ServiceDeps): Services {
  const clock = deps.clock ?? Date.now
  const audit = new AuditService(deps.db, deps.securityLogger, deps.deviceId, clock)
  const auth = new AuthService({
    db: deps.db,
    audit,
    logger: deps.securityLogger,
    deviceId: deps.deviceId,
    clock,
    ...(deps.authOptions ? { options: deps.authOptions } : {})
  })

  // Startup housekeeping: the permission list follows the code, and no session survives a restart.
  deps.db.transaction((tx) => {
    syncPermissionCatalog(tx)
  })
  auth.revokeStaleSessions()

  const categories = new CategoryService(deps.db, audit)
  const items = new ItemService(deps.db, audit)
  const inventory = new InventoryService(deps.db, audit, clock)
  const kots = new KotService(deps.db, audit, clock, inventory)
  const printers = new PrinterService(deps.db, audit)
  const billingSettings = new BillingSettingsService(deps.db, audit)
  const drivers: PrinterDrivers = { NETWORK: new NetworkPrinterDriver(), ...deps.printDrivers }
  const print = new PrintService(deps.db, audit, clock, kots, printers, drivers, deps.logger)
  const bills = new BillService(deps.db, audit, clock, billingSettings)
  const orders = new OrderService(deps.db, audit, clock, kots, inventory)
  const tables = new TableService(deps.db, audit, clock)

  return {
    audit,
    auth,
    setup: new SetupService(deps.db, audit, deps.logger),
    restaurant: new RestaurantService(deps.db, audit),
    users: new UserService(deps.db, audit, auth),
    roles: new RoleService(deps.db, audit),
    areas: new AreaService(deps.db, audit),
    tables,
    tableOps: new TableOperationService(deps.db, audit, clock, kots, orders),
    stations: new StationService(deps.db, audit),
    categories,
    taxCategories: new TaxCategoryService(deps.db, audit),
    addons: new AddonService(deps.db, audit),
    items,
    demoMenu: new DemoMenuService(deps.db, audit, deps.allowDemoData ?? false),
    orders,
    kots,
    printers,
    print,
    orderCatalog: new OrderCatalogService(items, categories),
    billingSettings,
    bills,
    receipts: new ReceiptService(deps.db, audit, bills, print, printers, deps.logger),
    customers: new CustomerService(deps.db, audit),
    reservations: new ReservationService(deps.db, audit, clock, tables),
    inventory,
    recipes: new RecipeService(deps.db, audit)
  }
}
