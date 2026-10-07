import { IPC_CHANNELS } from '@shared/ipc-channels'
import { idInputSchema } from '@shared/auth-schemas'
import { emptyInputSchema } from '@shared/schemas'
import {
  createAreaInputSchema,
  createTableInputSchema,
  openTableInputSchema,
  saveLayoutInputSchema,
  setActiveInputSchema,
  updateAreaInputSchema,
  updateTableInputSchema
} from '@shared/tables'
import { mergeTablesInputSchema, shiftTableInputSchema } from '@shared/table-ops'
import type { IpcRegistrar } from './ipc/registrar'
import type { Services } from './services'

/** Areas, tables, floor plan and table open/close handlers. */
export function registerTableHandlers(registrar: IpcRegistrar, services: Services): void {
  const { areas, tables, tableOps } = services

  // --- Read: admin lists and the POS floor ------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.areasList,
    emptyInputSchema,
    { permissions: ['tables.view'] },
    () => areas.list()
  )
  registrar.handleProtected(
    IPC_CHANNELS.tablesList,
    emptyInputSchema,
    { permissions: ['tables.view'] },
    () => tables.list()
  )
  registrar.handleProtected(
    IPC_CHANNELS.tablesFloor,
    emptyInputSchema,
    { permissions: ['tables.view'] },
    () => tables.floor()
  )

  // --- Setup: areas -----------------------------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.areasCreate,
    createAreaInputSchema,
    { permissions: ['tables.manage'] },
    (input, ctx) => areas.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.areasUpdate,
    updateAreaInputSchema,
    { permissions: ['tables.manage'] },
    (input, ctx) => areas.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.areasSetActive,
    setActiveInputSchema,
    { permissions: ['tables.manage'] },
    (input, ctx) => areas.setActive(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.areasDelete,
    idInputSchema,
    { permissions: ['tables.manage'] },
    (input, ctx) => {
      areas.delete(ctx, input.id)
      return null
    }
  )

  // --- Setup: tables and layout -----------------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.tablesCreate,
    createTableInputSchema,
    { permissions: ['tables.manage'] },
    (input, ctx) => tables.create(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.tablesUpdate,
    updateTableInputSchema,
    { permissions: ['tables.manage'] },
    (input, ctx) => tables.update(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.tablesSetActive,
    setActiveInputSchema,
    { permissions: ['tables.manage'] },
    (input, ctx) => tables.setActive(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.tablesSaveLayout,
    saveLayoutInputSchema,
    { permissions: ['tables.manage'] },
    (input, ctx) => tables.saveLayout(ctx, input)
  )

  // --- Service: open, close, block --------------------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.tablesOpen,
    openTableInputSchema,
    { permissions: ['tables.operate'] },
    (input, ctx) => tables.open(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.tablesClose,
    idInputSchema,
    { permissions: ['tables.operate'] },
    (input, ctx) => tables.close(ctx, input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.tablesBlock,
    idInputSchema,
    { permissions: ['tables.operate'] },
    (input, ctx) => tables.block(ctx, input.id)
  )
  registrar.handleProtected(
    IPC_CHANNELS.tablesUnblock,
    idInputSchema,
    { permissions: ['tables.operate'] },
    (input, ctx) => tables.unblock(ctx, input.id)
  )

  // --- Service: shift a party, merge two tables --------------------------------------------
  registrar.handleProtected(
    IPC_CHANNELS.tablesShift,
    shiftTableInputSchema,
    { permissions: ['tables.transfer'] },
    (input, ctx) => tableOps.shift(ctx, input)
  )
  registrar.handleProtected(
    IPC_CHANNELS.tablesMerge,
    mergeTablesInputSchema,
    { permissions: ['tables.transfer'] },
    (input, ctx) => tableOps.merge(ctx, input)
  )
}
