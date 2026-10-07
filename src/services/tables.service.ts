import type { OrderDetail } from '@shared/orders'
import type { MergeTablesInput, ShiftTableInput } from '@shared/table-ops'
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
} from '@shared/tables'
import { getApi, unwrap } from '@/lib/ipc'

export const areaService = {
  list: (): Promise<AreaSummary[]> => unwrap(getApi().areas.list()),
  create: (input: CreateAreaInput): Promise<AreaSummary> => unwrap(getApi().areas.create(input)),
  update: (input: UpdateAreaInput): Promise<AreaSummary> => unwrap(getApi().areas.update(input)),
  setActive: (input: SetActiveInput): Promise<AreaSummary> =>
    unwrap(getApi().areas.setActive(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().areas.delete(id))
}

export const tableService = {
  list: (): Promise<DiningTable[]> => unwrap(getApi().tables.list()),
  floor: (): Promise<FloorArea[]> => unwrap(getApi().tables.floor()),
  create: (input: CreateTableInput): Promise<DiningTable> => unwrap(getApi().tables.create(input)),
  update: (input: UpdateTableInput): Promise<DiningTable> => unwrap(getApi().tables.update(input)),
  setActive: (input: SetActiveInput): Promise<DiningTable> =>
    unwrap(getApi().tables.setActive(input)),
  saveLayout: (input: SaveLayoutInput): Promise<DiningTable[]> =>
    unwrap(getApi().tables.saveLayout(input)),
  open: (input: OpenTableInput): Promise<DiningTable> => unwrap(getApi().tables.open(input)),
  close: (id: string): Promise<DiningTable> => unwrap(getApi().tables.close(id)),
  block: (id: string): Promise<DiningTable> => unwrap(getApi().tables.block(id)),
  unblock: (id: string): Promise<DiningTable> => unwrap(getApi().tables.unblock(id)),
  shift: (input: ShiftTableInput): Promise<OrderDetail> => unwrap(getApi().tables.shift(input)),
  merge: (input: MergeTablesInput): Promise<OrderDetail> => unwrap(getApi().tables.merge(input))
}
