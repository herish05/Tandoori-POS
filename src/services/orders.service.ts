import type {
  AddItemsInput,
  CancelLineInput,
  CancelOrderInput,
  CreateOrderInput,
  OrderDetail,
  OrderFilterInput,
  OrderSummary,
  PosCatalog,
  RemoveLineInput,
  SetOrderStatusInput,
  UpdateLineInput,
  UpdateOrderInput
} from '@shared/orders'
import { getApi, unwrap } from '@/lib/ipc'

export const orderService = {
  catalog: (): Promise<PosCatalog> => unwrap(getApi().orders.catalog()),
  list: (filter: OrderFilterInput = {}): Promise<OrderSummary[]> =>
    unwrap(getApi().orders.list(filter)),
  get: (id: string): Promise<OrderDetail> => unwrap(getApi().orders.get(id)),
  create: (input: CreateOrderInput): Promise<OrderDetail> => unwrap(getApi().orders.create(input)),
  update: (input: UpdateOrderInput): Promise<OrderDetail> => unwrap(getApi().orders.update(input)),
  addItems: (input: AddItemsInput): Promise<OrderDetail> => unwrap(getApi().orders.addItems(input)),
  updateLine: (input: UpdateLineInput): Promise<OrderDetail> =>
    unwrap(getApi().orders.updateLine(input)),
  removeLine: (input: RemoveLineInput): Promise<OrderDetail> =>
    unwrap(getApi().orders.removeLine(input)),
  cancelLine: (input: CancelLineInput): Promise<OrderDetail> =>
    unwrap(getApi().orders.cancelLine(input)),
  send: (id: string): Promise<OrderDetail> => unwrap(getApi().orders.send(id)),
  setStatus: (input: SetOrderStatusInput): Promise<OrderDetail> =>
    unwrap(getApi().orders.setStatus(input)),
  cancel: (input: CancelOrderInput): Promise<OrderDetail> => unwrap(getApi().orders.cancel(input))
}
