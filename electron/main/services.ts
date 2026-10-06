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
import { OrderCatalogService } from './orders/catalog-service'
import { OrderService } from './orders/order-service'
import { RestaurantService } from './restaurant/restaurant-service'
import { SetupService } from './setup/setup-service'
import { AreaService } from './tables/area-service'
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
  stations: StationService
  categories: CategoryService
  taxCategories: TaxCategoryService
  addons: AddonService
  items: ItemService
  demoMenu: DemoMenuService
  orders: OrderService
  orderCatalog: OrderCatalogService
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

  return {
    audit,
    auth,
    setup: new SetupService(deps.db, audit, deps.logger),
    restaurant: new RestaurantService(deps.db, audit),
    users: new UserService(deps.db, audit, auth),
    roles: new RoleService(deps.db, audit),
    areas: new AreaService(deps.db, audit),
    tables: new TableService(deps.db, audit, clock),
    stations: new StationService(deps.db, audit),
    categories,
    taxCategories: new TaxCategoryService(deps.db, audit),
    addons: new AddonService(deps.db, audit),
    items,
    demoMenu: new DemoMenuService(deps.db, audit, deps.allowDemoData ?? false),
    orders: new OrderService(deps.db, audit, clock),
    orderCatalog: new OrderCatalogService(items, categories)
  }
}
