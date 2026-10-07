import { IPC_CHANNELS } from '@shared/ipc-channels'
import { idInputSchema } from '@shared/auth-schemas'
import {
  addItemsInputSchema,
  cancelLineInputSchema,
  cancelOrderInputSchema,
  createOrderInputSchema,
  dispatchOrderInputSchema,
  orderFilterSchema,
  removeLineInputSchema,
  setOrderStatusInputSchema,
  updateLineInputSchema,
  updateOrderInputSchema
} from '@shared/orders'
import type { SendOrderResult } from '@shared/kitchen'
import { emptyInputSchema } from '@shared/schemas'
import type { IpcRegistrar } from './ipc/registrar'
import type { Services } from './services'

const VIEW = { permissions: ['orders.view'] } as const
const OPERATE = { permissions: ['orders.operate'] } as const
const CANCEL = { permissions: ['orders.cancel'] } as const

/** Order handlers: the ordering menu, creating and editing orders, sending and cancelling them. */
export function registerOrderHandlers(registrar: IpcRegistrar, services: Services): void {
  const { orders, orderCatalog } = services

  // --- Read ---------------------------------------------------------------------------------
  registrar.handleProtected(IPC_CHANNELS.ordersCatalog, emptyInputSchema, OPERATE, () =>
    orderCatalog.get()
  )
  registrar.handleProtected(IPC_CHANNELS.ordersList, orderFilterSchema, VIEW, (input) =>
    orders.list(input)
  )
  registrar.handleProtected(IPC_CHANNELS.ordersGet, idInputSchema, VIEW, (input) =>
    orders.get(input.id)
  )

  // --- Take and change orders ---------------------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.ordersCreate,
    createOrderInputSchema,
    OPERATE,
    (input, ctx) => orders.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.ordersUpdate,
    updateOrderInputSchema,
    OPERATE,
    (input, ctx) => orders.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.ordersAddItems,
    addItemsInputSchema,
    OPERATE,
    (input, ctx) => orders.addItems(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.ordersUpdateLine,
    updateLineInputSchema,
    OPERATE,
    (input, ctx) => orders.updateLine(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.ordersRemoveLine,
    removeLineInputSchema,
    OPERATE,
    (input, ctx) => orders.removeLine(ctx, input)
  )
  // Sending issues the kitchen tickets and prints them. A printer problem never undoes the send:
  // the result says which tickets did not print so the screen can offer a reprint.
  registrar.handleProtected(
    IPC_CHANNELS.ordersSend,
    idInputSchema,
    OPERATE,
    async (input, ctx): Promise<SendOrderResult> => {
      const sent = orders.sendAndGetKots(ctx, input.id)
      const print = await services.print.printKots(ctx, sent.kotIds)
      return {
        order: orders.get(input.id),
        kots: sent.kotIds.map((id) => services.kots.get(id)),
        print
      }
    }
  )
  registrar.handleProtected(
    IPC_CHANNELS.ordersSetStatus,
    setOrderStatusInputSchema,
    OPERATE,
    (input, ctx) => orders.setStatus(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.ordersDispatch,
    dispatchOrderInputSchema,
    OPERATE,
    (input, ctx) => orders.dispatch(ctx, input)
  )

  // --- Cancel ---------------------------------------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.ordersCancelLine,
    cancelLineInputSchema,
    CANCEL,
    (input, ctx) => orders.cancelLine(ctx, input)
  )
  // Dropping a draft needs only "take orders"; the service demands the cancel permission for
  // anything already sent.
  registrar.handleProtected(
    IPC_CHANNELS.ordersCancel,
    cancelOrderInputSchema,
    OPERATE,
    (input, ctx) => orders.cancel(ctx, input)
  )
}
