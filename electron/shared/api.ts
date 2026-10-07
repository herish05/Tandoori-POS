import type {
  AuditLogPage,
  PermissionInfo,
  RestaurantProfile,
  RoleRef,
  RoleSummary,
  SessionInfo,
  SessionSnapshot,
  SetupStatus,
  StaffMember
} from './domain'
import type {
  AuditQueryInput,
  ChangePasswordInput,
  CreateRoleInput,
  CreateStaffInput,
  LoginInput,
  ResetPasswordInput,
  RestaurantInput,
  SetupInput,
  UpdateRoleInput,
  UpdateStaffInput
} from './auth-schemas'
import type {
  CreateAddonInput,
  CreateCategoryInput,
  CreateItemInput,
  CreateStationInput,
  CreateTaxCategoryInput,
  DemoMenuStatus,
  DemoRemoveResult,
  ItemFilterInput,
  KitchenStation,
  MenuAddon,
  MenuCategory,
  MenuItem,
  SetActiveMenuInput,
  SetAvailabilityInput,
  TaxCategory,
  UpdateAddonInput,
  UpdateCategoryInput,
  UpdateItemInput,
  UpdateStationInput,
  UpdateTaxCategoryInput
} from './menu'
import type {
  CancelKotInput,
  CreatePrinterInput,
  KotBoardInput,
  KotDetail,
  KotFilterInput,
  KotPreview,
  KotPreviewInput,
  KotPrintOutcome,
  KotSummary,
  PrinterConfig,
  PrinterTestOutcome,
  SendOrderResult,
  SetKotStatusInput,
  UpdatePrinterInput
} from './kitchen'
import type {
  ApplyDiscountInput,
  BillDetail,
  BillFilterInput,
  BillSummary,
  BillingSettings,
  CancelBillInput,
  GenerateBillInput,
  PayBillInput,
  PayBillResult,
  RefundBillInput,
  RefundBillResult,
  RemoveDiscountInput,
  UpdateBillingSettingsInput
} from './billing'
import type {
  PrintReceiptInput,
  ReceiptPreview,
  ReceiptPreviewInput,
  ReceiptPrintOutcome,
  ReceiptPrintRecord
} from './receipts'
import type {
  AddItemsInput,
  CancelLineInput,
  CancelOrderInput,
  CreateOrderInput,
  DispatchOrderInput,
  OrderDetail,
  OrderFilterInput,
  OrderSummary,
  PosCatalog,
  RemoveLineInput,
  SetOrderStatusInput,
  UpdateLineInput,
  UpdateOrderInput
} from './orders'
import type { MergeTablesInput, ShiftTableInput } from './table-ops'
import type {
  AddAddressInput,
  CreateCustomerInput,
  CustomerDetail,
  CustomerFilterInput,
  CustomerLookupInput,
  CustomerLookupResult,
  CustomerSummary,
  UpdateAddressInput,
  UpdateCustomerInput
} from './customers'
import type {
  CancelReservationInput,
  CreateReservationInput,
  Reservation,
  ReservationFilterInput,
  SeatReservationInput,
  UpdateReservationInput
} from './reservations'
import type {
  CreateInventoryItemInput,
  InventoryFilterInput,
  InventoryItem,
  InventorySummary,
  MovementFilterInput,
  Recipe,
  RecipeCoverage,
  SetInventoryItemActiveInput,
  SetRecipeInput,
  StockCountInput,
  StockInInput,
  StockMovement,
  UpdateInventoryItemInput,
  WastageInput
} from './inventory'
import type {
  AreaSummary,
  CreateAreaInput,
  CreateTableInput,
  DiningTable,
  FloorArea,
  OpenTableInput,
  SaveLayoutInput,
  SetActiveInput,
  UpdateAreaInput,
  UpdateTableInput
} from './tables'
import type {
  AppInfo,
  HealthReport,
  IpcResult,
  LogWriteInput,
  UserConfig,
  WindowState
} from './types'

/**
 * The complete API that the preload script exposes on `window.tandoori`.
 * Adding a capability to the renderer means adding it here, in the preload and in a validated IPC handler.
 */
export interface TandooriApi {
  app: {
    getInfo: () => Promise<IpcResult<AppInfo>>
  }
  health: {
    check: () => Promise<IpcResult<HealthReport>>
  }
  config: {
    get: () => Promise<IpcResult<UserConfig>>
    update: (patch: Partial<UserConfig>) => Promise<IpcResult<UserConfig>>
  }
  window: {
    getState: () => Promise<IpcResult<WindowState>>
    minimize: () => Promise<IpcResult<null>>
    toggleMaximize: () => Promise<IpcResult<WindowState>>
    toggleFullscreen: () => Promise<IpcResult<WindowState>>
    close: () => Promise<IpcResult<null>>
    onStateChanged: (listener: (state: WindowState) => void) => () => void
  }
  log: {
    write: (entry: LogWriteInput) => Promise<IpcResult<null>>
  }
  setup: {
    getStatus: () => Promise<IpcResult<SetupStatus>>
    complete: (input: SetupInput) => Promise<IpcResult<null>>
  }
  auth: {
    login: (input: LoginInput) => Promise<IpcResult<SessionInfo>>
    logout: () => Promise<IpcResult<null>>
    getSession: () => Promise<IpcResult<SessionSnapshot>>
    touch: () => Promise<IpcResult<null>>
    changePassword: (input: ChangePasswordInput) => Promise<IpcResult<SessionInfo>>
  }
  restaurant: {
    get: () => Promise<IpcResult<RestaurantProfile>>
    update: (input: RestaurantInput) => Promise<IpcResult<RestaurantProfile>>
  }
  users: {
    list: () => Promise<IpcResult<StaffMember[]>>
    create: (input: CreateStaffInput) => Promise<IpcResult<StaffMember>>
    update: (input: UpdateStaffInput) => Promise<IpcResult<StaffMember>>
    resetPassword: (input: ResetPasswordInput) => Promise<IpcResult<null>>
    assignableRoles: () => Promise<IpcResult<RoleRef[]>>
  }
  roles: {
    list: () => Promise<IpcResult<RoleSummary[]>>
    create: (input: CreateRoleInput) => Promise<IpcResult<RoleSummary>>
    update: (input: UpdateRoleInput) => Promise<IpcResult<RoleSummary>>
    delete: (id: string) => Promise<IpcResult<null>>
  }
  permissions: {
    list: () => Promise<IpcResult<PermissionInfo[]>>
  }
  audit: {
    list: (query: AuditQueryInput) => Promise<IpcResult<AuditLogPage>>
  }
  areas: {
    list: () => Promise<IpcResult<AreaSummary[]>>
    create: (input: CreateAreaInput) => Promise<IpcResult<AreaSummary>>
    update: (input: UpdateAreaInput) => Promise<IpcResult<AreaSummary>>
    setActive: (input: SetActiveInput) => Promise<IpcResult<AreaSummary>>
    delete: (id: string) => Promise<IpcResult<null>>
  }
  tables: {
    list: () => Promise<IpcResult<DiningTable[]>>
    floor: () => Promise<IpcResult<FloorArea[]>>
    create: (input: CreateTableInput) => Promise<IpcResult<DiningTable>>
    update: (input: UpdateTableInput) => Promise<IpcResult<DiningTable>>
    setActive: (input: SetActiveInput) => Promise<IpcResult<DiningTable>>
    saveLayout: (input: SaveLayoutInput) => Promise<IpcResult<DiningTable[]>>
    open: (input: OpenTableInput) => Promise<IpcResult<DiningTable>>
    close: (id: string) => Promise<IpcResult<DiningTable>>
    block: (id: string) => Promise<IpcResult<DiningTable>>
    unblock: (id: string) => Promise<IpcResult<DiningTable>>
    shift: (input: ShiftTableInput) => Promise<IpcResult<OrderDetail>>
    merge: (input: MergeTablesInput) => Promise<IpcResult<OrderDetail>>
  }
  menu: {
    stations: {
      list: () => Promise<IpcResult<KitchenStation[]>>
      create: (input: CreateStationInput) => Promise<IpcResult<KitchenStation>>
      update: (input: UpdateStationInput) => Promise<IpcResult<KitchenStation>>
      setActive: (input: SetActiveMenuInput) => Promise<IpcResult<KitchenStation>>
      delete: (id: string) => Promise<IpcResult<null>>
    }
    categories: {
      list: () => Promise<IpcResult<MenuCategory[]>>
      create: (input: CreateCategoryInput) => Promise<IpcResult<MenuCategory>>
      update: (input: UpdateCategoryInput) => Promise<IpcResult<MenuCategory>>
      setActive: (input: SetActiveMenuInput) => Promise<IpcResult<MenuCategory>>
      delete: (id: string) => Promise<IpcResult<null>>
    }
    taxCategories: {
      list: () => Promise<IpcResult<TaxCategory[]>>
      create: (input: CreateTaxCategoryInput) => Promise<IpcResult<TaxCategory>>
      update: (input: UpdateTaxCategoryInput) => Promise<IpcResult<TaxCategory>>
      setActive: (input: SetActiveMenuInput) => Promise<IpcResult<TaxCategory>>
      delete: (id: string) => Promise<IpcResult<null>>
    }
    addons: {
      list: () => Promise<IpcResult<MenuAddon[]>>
      create: (input: CreateAddonInput) => Promise<IpcResult<MenuAddon>>
      update: (input: UpdateAddonInput) => Promise<IpcResult<MenuAddon>>
      setActive: (input: SetActiveMenuInput) => Promise<IpcResult<MenuAddon>>
      delete: (id: string) => Promise<IpcResult<null>>
    }
    items: {
      list: (filter: ItemFilterInput) => Promise<IpcResult<MenuItem[]>>
      create: (input: CreateItemInput) => Promise<IpcResult<MenuItem>>
      update: (input: UpdateItemInput) => Promise<IpcResult<MenuItem>>
      setActive: (input: SetActiveMenuInput) => Promise<IpcResult<MenuItem>>
      setAvailability: (input: SetAvailabilityInput) => Promise<IpcResult<MenuItem>>
      delete: (id: string) => Promise<IpcResult<null>>
    }
    demo: {
      status: () => Promise<IpcResult<DemoMenuStatus>>
      load: () => Promise<IpcResult<DemoMenuStatus>>
      remove: () => Promise<IpcResult<DemoRemoveResult>>
    }
  }
  orders: {
    catalog: () => Promise<IpcResult<PosCatalog>>
    list: (filter: OrderFilterInput) => Promise<IpcResult<OrderSummary[]>>
    get: (id: string) => Promise<IpcResult<OrderDetail>>
    create: (input: CreateOrderInput) => Promise<IpcResult<OrderDetail>>
    update: (input: UpdateOrderInput) => Promise<IpcResult<OrderDetail>>
    addItems: (input: AddItemsInput) => Promise<IpcResult<OrderDetail>>
    updateLine: (input: UpdateLineInput) => Promise<IpcResult<OrderDetail>>
    removeLine: (input: RemoveLineInput) => Promise<IpcResult<OrderDetail>>
    cancelLine: (input: CancelLineInput) => Promise<IpcResult<OrderDetail>>
    send: (id: string) => Promise<IpcResult<SendOrderResult>>
    setStatus: (input: SetOrderStatusInput) => Promise<IpcResult<OrderDetail>>
    dispatch: (input: DispatchOrderInput) => Promise<IpcResult<OrderDetail>>
    cancel: (input: CancelOrderInput) => Promise<IpcResult<OrderDetail>>
  }
  kots: {
    list: (filter: KotFilterInput) => Promise<IpcResult<KotSummary[]>>
    get: (id: string) => Promise<IpcResult<KotDetail>>
    board: (input: KotBoardInput) => Promise<IpcResult<KotDetail[]>>
    setStatus: (input: SetKotStatusInput) => Promise<IpcResult<KotDetail>>
    cancel: (input: CancelKotInput) => Promise<IpcResult<KotDetail>>
    preview: (input: KotPreviewInput) => Promise<IpcResult<KotPreview>>
    print: (id: string) => Promise<IpcResult<KotPrintOutcome>>
  }
  billing: {
    settings: () => Promise<IpcResult<BillingSettings>>
    updateSettings: (input: UpdateBillingSettingsInput) => Promise<IpcResult<BillingSettings>>
  }
  bills: {
    list: (filter: BillFilterInput) => Promise<IpcResult<BillSummary[]>>
    get: (id: string) => Promise<IpcResult<BillDetail>>
    generate: (input: GenerateBillInput) => Promise<IpcResult<BillDetail>>
    applyDiscount: (input: ApplyDiscountInput) => Promise<IpcResult<BillDetail>>
    removeDiscount: (input: RemoveDiscountInput) => Promise<IpcResult<BillDetail>>
    cancel: (input: CancelBillInput) => Promise<IpcResult<BillDetail>>
    pay: (input: PayBillInput) => Promise<IpcResult<PayBillResult>>
    refund: (input: RefundBillInput) => Promise<IpcResult<RefundBillResult>>
  }
  receipts: {
    preview: (input: ReceiptPreviewInput) => Promise<IpcResult<ReceiptPreview>>
    print: (input: PrintReceiptInput) => Promise<IpcResult<ReceiptPrintOutcome>>
    history: (billId: string) => Promise<IpcResult<ReceiptPrintRecord[]>>
  }
  customers: {
    list: (filter: CustomerFilterInput) => Promise<IpcResult<CustomerSummary[]>>
    get: (id: string) => Promise<IpcResult<CustomerDetail>>
    lookup: (input: CustomerLookupInput) => Promise<IpcResult<CustomerLookupResult[]>>
    create: (input: CreateCustomerInput) => Promise<IpcResult<CustomerDetail>>
    update: (input: UpdateCustomerInput) => Promise<IpcResult<CustomerDetail>>
    delete: (id: string) => Promise<IpcResult<null>>
    addAddress: (input: AddAddressInput) => Promise<IpcResult<CustomerDetail>>
    updateAddress: (input: UpdateAddressInput) => Promise<IpcResult<CustomerDetail>>
    removeAddress: (id: string) => Promise<IpcResult<CustomerDetail>>
  }
  reservations: {
    list: (filter: ReservationFilterInput) => Promise<IpcResult<Reservation[]>>
    get: (id: string) => Promise<IpcResult<Reservation>>
    create: (input: CreateReservationInput) => Promise<IpcResult<Reservation>>
    update: (input: UpdateReservationInput) => Promise<IpcResult<Reservation>>
    cancel: (input: CancelReservationInput) => Promise<IpcResult<Reservation>>
    noShow: (id: string) => Promise<IpcResult<Reservation>>
    seat: (input: SeatReservationInput) => Promise<IpcResult<Reservation>>
  }
  inventory: {
    summary: () => Promise<IpcResult<InventorySummary>>
    list: (filter: InventoryFilterInput) => Promise<IpcResult<InventoryItem[]>>
    create: (input: CreateInventoryItemInput) => Promise<IpcResult<InventoryItem>>
    update: (input: UpdateInventoryItemInput) => Promise<IpcResult<InventoryItem>>
    setActive: (input: SetInventoryItemActiveInput) => Promise<IpcResult<InventoryItem>>
    delete: (id: string) => Promise<IpcResult<null>>
    stockIn: (input: StockInInput) => Promise<IpcResult<InventoryItem>>
    wastage: (input: WastageInput) => Promise<IpcResult<InventoryItem>>
    count: (input: StockCountInput) => Promise<IpcResult<InventoryItem>>
    movements: (filter: MovementFilterInput) => Promise<IpcResult<StockMovement[]>>
  }
  recipes: {
    coverage: () => Promise<IpcResult<RecipeCoverage[]>>
    get: (menuItemId: string) => Promise<IpcResult<Recipe>>
    set: (input: SetRecipeInput) => Promise<IpcResult<Recipe>>
  }
  printers: {
    list: () => Promise<IpcResult<PrinterConfig[]>>
    create: (input: CreatePrinterInput) => Promise<IpcResult<PrinterConfig>>
    update: (input: UpdatePrinterInput) => Promise<IpcResult<PrinterConfig>>
    delete: (id: string) => Promise<IpcResult<null>>
    test: (id: string) => Promise<IpcResult<PrinterTestOutcome>>
    systemDevices: () => Promise<IpcResult<string[]>>
  }
}
