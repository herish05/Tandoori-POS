import { contextBridge, ipcRenderer } from 'electron'
import type { TandooriApi } from '@shared/api'
import { IPC_CHANNELS, type IpcChannel } from '@shared/ipc-channels'
import type { WindowState } from '@shared/types'

/**
 * The preload script is the only bridge between the sandboxed renderer and the main process.
 * It exposes a fixed set of functions; `ipcRenderer` itself is never exposed.
 */
const invoke = <T>(channel: IpcChannel, payload?: unknown) =>
  ipcRenderer.invoke(channel, payload) as Promise<T>

const api: TandooriApi = {
  app: {
    getInfo: () => invoke(IPC_CHANNELS.appGetInfo)
  },
  health: {
    check: () => invoke(IPC_CHANNELS.healthCheck)
  },
  config: {
    get: () => invoke(IPC_CHANNELS.configGet),
    update: (patch) => invoke(IPC_CHANNELS.configUpdate, patch)
  },
  window: {
    getState: () => invoke(IPC_CHANNELS.windowGetState),
    minimize: () => invoke(IPC_CHANNELS.windowMinimize),
    toggleMaximize: () => invoke(IPC_CHANNELS.windowToggleMaximize),
    toggleFullscreen: () => invoke(IPC_CHANNELS.windowToggleFullscreen),
    close: () => invoke(IPC_CHANNELS.windowClose),
    onStateChanged: (listener) => {
      const wrapped = (_event: unknown, state: WindowState): void => {
        listener(state)
      }
      ipcRenderer.on(IPC_CHANNELS.windowStateChanged, wrapped)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.windowStateChanged, wrapped)
      }
    }
  },
  log: {
    write: (entry) => invoke(IPC_CHANNELS.logWrite, entry)
  },
  setup: {
    getStatus: () => invoke(IPC_CHANNELS.setupGetStatus),
    complete: (input) => invoke(IPC_CHANNELS.setupComplete, input)
  },
  auth: {
    login: (input) => invoke(IPC_CHANNELS.authLogin, input),
    logout: () => invoke(IPC_CHANNELS.authLogout),
    getSession: () => invoke(IPC_CHANNELS.authGetSession),
    touch: () => invoke(IPC_CHANNELS.authTouch),
    changePassword: (input) => invoke(IPC_CHANNELS.authChangePassword, input)
  },
  restaurant: {
    get: () => invoke(IPC_CHANNELS.restaurantGet),
    update: (input) => invoke(IPC_CHANNELS.restaurantUpdate, input)
  },
  users: {
    list: () => invoke(IPC_CHANNELS.usersList),
    create: (input) => invoke(IPC_CHANNELS.usersCreate, input),
    update: (input) => invoke(IPC_CHANNELS.usersUpdate, input),
    resetPassword: (input) => invoke(IPC_CHANNELS.usersResetPassword, input),
    assignableRoles: () => invoke(IPC_CHANNELS.usersAssignableRoles)
  },
  roles: {
    list: () => invoke(IPC_CHANNELS.rolesList),
    create: (input) => invoke(IPC_CHANNELS.rolesCreate, input),
    update: (input) => invoke(IPC_CHANNELS.rolesUpdate, input),
    delete: (id) => invoke(IPC_CHANNELS.rolesDelete, { id })
  },
  permissions: {
    list: () => invoke(IPC_CHANNELS.permissionsList)
  },
  audit: {
    list: (query) => invoke(IPC_CHANNELS.auditList, query)
  },
  areas: {
    list: () => invoke(IPC_CHANNELS.areasList),
    create: (input) => invoke(IPC_CHANNELS.areasCreate, input),
    update: (input) => invoke(IPC_CHANNELS.areasUpdate, input),
    setActive: (input) => invoke(IPC_CHANNELS.areasSetActive, input),
    delete: (id) => invoke(IPC_CHANNELS.areasDelete, { id })
  },
  tables: {
    list: () => invoke(IPC_CHANNELS.tablesList),
    floor: () => invoke(IPC_CHANNELS.tablesFloor),
    create: (input) => invoke(IPC_CHANNELS.tablesCreate, input),
    update: (input) => invoke(IPC_CHANNELS.tablesUpdate, input),
    setActive: (input) => invoke(IPC_CHANNELS.tablesSetActive, input),
    saveLayout: (input) => invoke(IPC_CHANNELS.tablesSaveLayout, input),
    open: (input) => invoke(IPC_CHANNELS.tablesOpen, input),
    close: (id) => invoke(IPC_CHANNELS.tablesClose, { id }),
    block: (id) => invoke(IPC_CHANNELS.tablesBlock, { id }),
    unblock: (id) => invoke(IPC_CHANNELS.tablesUnblock, { id }),
    shift: (input) => invoke(IPC_CHANNELS.tablesShift, input),
    merge: (input) => invoke(IPC_CHANNELS.tablesMerge, input)
  },
  menu: {
    stations: {
      list: () => invoke(IPC_CHANNELS.stationsList),
      create: (input) => invoke(IPC_CHANNELS.stationsCreate, input),
      update: (input) => invoke(IPC_CHANNELS.stationsUpdate, input),
      setActive: (input) => invoke(IPC_CHANNELS.stationsSetActive, input),
      delete: (id) => invoke(IPC_CHANNELS.stationsDelete, { id })
    },
    categories: {
      list: () => invoke(IPC_CHANNELS.categoriesList),
      create: (input) => invoke(IPC_CHANNELS.categoriesCreate, input),
      update: (input) => invoke(IPC_CHANNELS.categoriesUpdate, input),
      setActive: (input) => invoke(IPC_CHANNELS.categoriesSetActive, input),
      delete: (id) => invoke(IPC_CHANNELS.categoriesDelete, { id })
    },
    taxCategories: {
      list: () => invoke(IPC_CHANNELS.taxCategoriesList),
      create: (input) => invoke(IPC_CHANNELS.taxCategoriesCreate, input),
      update: (input) => invoke(IPC_CHANNELS.taxCategoriesUpdate, input),
      setActive: (input) => invoke(IPC_CHANNELS.taxCategoriesSetActive, input),
      delete: (id) => invoke(IPC_CHANNELS.taxCategoriesDelete, { id })
    },
    addons: {
      list: () => invoke(IPC_CHANNELS.addonsList),
      create: (input) => invoke(IPC_CHANNELS.addonsCreate, input),
      update: (input) => invoke(IPC_CHANNELS.addonsUpdate, input),
      setActive: (input) => invoke(IPC_CHANNELS.addonsSetActive, input),
      delete: (id) => invoke(IPC_CHANNELS.addonsDelete, { id })
    },
    items: {
      list: (filter) => invoke(IPC_CHANNELS.itemsList, filter),
      create: (input) => invoke(IPC_CHANNELS.itemsCreate, input),
      update: (input) => invoke(IPC_CHANNELS.itemsUpdate, input),
      setActive: (input) => invoke(IPC_CHANNELS.itemsSetActive, input),
      setAvailability: (input) => invoke(IPC_CHANNELS.itemsSetAvailability, input),
      delete: (id) => invoke(IPC_CHANNELS.itemsDelete, { id })
    },
    demo: {
      status: () => invoke(IPC_CHANNELS.demoStatus),
      load: () => invoke(IPC_CHANNELS.demoLoad),
      remove: () => invoke(IPC_CHANNELS.demoRemove)
    }
  },
  orders: {
    catalog: () => invoke(IPC_CHANNELS.ordersCatalog),
    list: (filter) => invoke(IPC_CHANNELS.ordersList, filter),
    get: (id) => invoke(IPC_CHANNELS.ordersGet, { id }),
    create: (input) => invoke(IPC_CHANNELS.ordersCreate, input),
    update: (input) => invoke(IPC_CHANNELS.ordersUpdate, input),
    addItems: (input) => invoke(IPC_CHANNELS.ordersAddItems, input),
    updateLine: (input) => invoke(IPC_CHANNELS.ordersUpdateLine, input),
    removeLine: (input) => invoke(IPC_CHANNELS.ordersRemoveLine, input),
    cancelLine: (input) => invoke(IPC_CHANNELS.ordersCancelLine, input),
    send: (id) => invoke(IPC_CHANNELS.ordersSend, { id }),
    setStatus: (input) => invoke(IPC_CHANNELS.ordersSetStatus, input),
    cancel: (input) => invoke(IPC_CHANNELS.ordersCancel, input)
  },
  kots: {
    list: (filter) => invoke(IPC_CHANNELS.kotsList, filter),
    get: (id) => invoke(IPC_CHANNELS.kotsGet, { id }),
    board: (input) => invoke(IPC_CHANNELS.kotsBoard, input),
    setStatus: (input) => invoke(IPC_CHANNELS.kotsSetStatus, input),
    cancel: (input) => invoke(IPC_CHANNELS.kotsCancel, input),
    preview: (input) => invoke(IPC_CHANNELS.kotsPreview, input),
    print: (id) => invoke(IPC_CHANNELS.kotsPrint, { id })
  },
  billing: {
    settings: () => invoke(IPC_CHANNELS.billingSettingsGet),
    updateSettings: (input) => invoke(IPC_CHANNELS.billingSettingsUpdate, input)
  },
  bills: {
    list: (filter) => invoke(IPC_CHANNELS.billsList, filter),
    get: (id) => invoke(IPC_CHANNELS.billsGet, { id }),
    generate: (input) => invoke(IPC_CHANNELS.billsGenerate, input),
    applyDiscount: (input) => invoke(IPC_CHANNELS.billsApplyDiscount, input),
    removeDiscount: (input) => invoke(IPC_CHANNELS.billsRemoveDiscount, input),
    cancel: (input) => invoke(IPC_CHANNELS.billsCancel, input),
    pay: (input) => invoke(IPC_CHANNELS.billsPay, input),
    refund: (input) => invoke(IPC_CHANNELS.billsRefund, input)
  },
  receipts: {
    preview: (input) => invoke(IPC_CHANNELS.receiptsPreview, input),
    print: (input) => invoke(IPC_CHANNELS.receiptsPrint, input),
    history: (billId) => invoke(IPC_CHANNELS.receiptsHistory, { id: billId })
  },
  printers: {
    list: () => invoke(IPC_CHANNELS.printersList),
    create: (input) => invoke(IPC_CHANNELS.printersCreate, input),
    update: (input) => invoke(IPC_CHANNELS.printersUpdate, input),
    delete: (id) => invoke(IPC_CHANNELS.printersDelete, { id }),
    test: (id) => invoke(IPC_CHANNELS.printersTest, { id }),
    systemDevices: () => invoke(IPC_CHANNELS.printersSystemDevices)
  }
}

contextBridge.exposeInMainWorld('tandoori', api)
