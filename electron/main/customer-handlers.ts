import { IPC_CHANNELS } from '@shared/ipc-channels'
import { idInputSchema } from '@shared/auth-schemas'
import {
  addAddressInputSchema,
  createCustomerInputSchema,
  customerFilterSchema,
  customerLookupInputSchema,
  updateAddressInputSchema,
  updateCustomerInputSchema
} from '@shared/customers'
import type { IpcRegistrar } from './ipc/registrar'
import type { Services } from './services'

const VIEW = { permissions: ['customers.view'] } as const
const MANAGE = { permissions: ['customers.manage'] } as const
// Anyone who takes orders can look a customer up to fill in an order.
const LOOKUP = { permissions: ['orders.operate'] } as const

/** Customer master handlers: the list, the details and addresses, and the order-screen lookup. */
export function registerCustomerHandlers(registrar: IpcRegistrar, services: Services): void {
  const { customers } = services

  registrar.handleProtected(IPC_CHANNELS.customersList, customerFilterSchema, VIEW, (input) =>
    customers.list(input)
  )
  registrar.handleProtected(IPC_CHANNELS.customersGet, idInputSchema, VIEW, (input) =>
    customers.get(input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.customersLookup,
    customerLookupInputSchema,
    LOOKUP,
    (input) => customers.lookup(input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.customersCreate,
    createCustomerInputSchema,
    MANAGE,
    (input, ctx) => customers.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.customersUpdate,
    updateCustomerInputSchema,
    MANAGE,
    (input, ctx) => customers.update(ctx, input)
  )
  registrar.handleProtected(IPC_CHANNELS.customersDelete, idInputSchema, MANAGE, (input, ctx) =>
    customers.delete(ctx, input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.customersAddAddress,
    addAddressInputSchema,
    MANAGE,
    (input, ctx) => customers.addAddress(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.customersUpdateAddress,
    updateAddressInputSchema,
    MANAGE,
    (input, ctx) => customers.updateAddress(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.customersRemoveAddress,
    idInputSchema,
    MANAGE,
    (input, ctx) => customers.removeAddress(ctx, input.id)
  )
}
