import { IPC_CHANNELS } from '@shared/ipc-channels'
import { idInputSchema } from '@shared/auth-schemas'
import {
  cancelKotInputSchema,
  createPrinterInputSchema,
  kotBoardInputSchema,
  kotFilterSchema,
  kotPreviewInputSchema,
  setKotStatusInputSchema,
  testPrinterInputSchema,
  updatePrinterInputSchema
} from '@shared/kitchen'
import type { PermissionCode } from '@shared/permissions'
import { emptyInputSchema } from '@shared/schemas'
import type { AuthContext } from './auth/types'
import { AppError } from './ipc/errors'
import type { IpcRegistrar } from './ipc/registrar'
import type { Services } from './services'

const ANY_SIGNED_IN = { permissions: [] } as const
const OPERATE_KITCHEN = { permissions: ['kitchen.operate'] } as const
const CANCEL_ORDERS = { permissions: ['orders.cancel'] } as const
const VIEW_PRINTERS = { permissions: ['printers.view'] } as const
const MANAGE_PRINTERS = { permissions: ['printers.manage'] } as const

/** Passes when the caller has at least one of the permissions. */
function requireAny(auth: AuthContext, codes: readonly PermissionCode[]): void {
  if (!codes.some((code) => auth.permissions.has(code))) {
    throw new AppError('FORBIDDEN', 'You do not have permission to do that.')
  }
}

const SEE_TICKETS: readonly PermissionCode[] = ['orders.view', 'kitchen.access']
const PRINT_TICKETS: readonly PermissionCode[] = ['orders.operate', 'kitchen.operate']

/** Kitchen order tickets and printers. */
export function registerKitchenHandlers(registrar: IpcRegistrar, services: Services): void {
  const { kots, printers, print } = services

  // --- Tickets ---------------------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.kotsList,
    kotFilterSchema,
    ANY_SIGNED_IN,
    (input, auth) => {
      requireAny(auth, SEE_TICKETS)
      return kots.list(input)
    }
  )
  registrar.handleProtected(
    IPC_CHANNELS.kotsBoard,
    kotBoardInputSchema,
    ANY_SIGNED_IN,
    (input, auth) => {
      requireAny(auth, SEE_TICKETS)
      return kots.board(input.stationId)
    }
  )
  registrar.handleProtected(IPC_CHANNELS.kotsGet, idInputSchema, ANY_SIGNED_IN, (input, auth) => {
    requireAny(auth, SEE_TICKETS)
    return kots.get(input.id)
  })
  registrar.handleProtected(
    IPC_CHANNELS.kotsSetStatus,
    setKotStatusInputSchema,
    OPERATE_KITCHEN,
    (input, auth) => kots.setStatus(auth, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.kotsCancel,
    cancelKotInputSchema,
    CANCEL_ORDERS,
    (input, auth) => kots.cancel(auth, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.kotsPreview,
    kotPreviewInputSchema,
    ANY_SIGNED_IN,
    (input, auth) => {
      requireAny(auth, SEE_TICKETS)
      return print.preview(input.id, input.paperWidth)
    }
  )
  registrar.handleProtected(IPC_CHANNELS.kotsPrint, idInputSchema, ANY_SIGNED_IN, (input, auth) => {
    requireAny(auth, PRINT_TICKETS)
    return print.printKot(auth, input.id, { reprint: true })
  })

  // --- Printers --------------------------------------------------------------
  registrar.handleProtected(IPC_CHANNELS.printersList, emptyInputSchema, VIEW_PRINTERS, () =>
    printers.list()
  )
  registrar.handleProtected(
    IPC_CHANNELS.printersCreate,
    createPrinterInputSchema,
    MANAGE_PRINTERS,
    (input, auth) => printers.create(auth, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.printersUpdate,
    updatePrinterInputSchema,
    MANAGE_PRINTERS,
    (input, auth) => printers.update(auth, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.printersDelete,
    idInputSchema,
    MANAGE_PRINTERS,
    (input, auth) => {
      printers.delete(auth, input.id)
      return null
    }
  )
  registrar.handleProtected(
    IPC_CHANNELS.printersTest,
    testPrinterInputSchema,
    MANAGE_PRINTERS,
    (input, auth) => print.testPrinter(auth, input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.printersSystemDevices,
    emptyInputSchema,
    MANAGE_PRINTERS,
    () => print.systemDevices()
  )
}
