import { z } from 'zod'

/**
 * Areas (dining rooms, floors, terraces) and the tables in them.
 * Shared by the renderer (instant feedback, labels) and the main process (the real checks).
 */

export const TABLE_TYPES = ['AC', 'NON_AC', 'OUTDOOR', 'OTHER'] as const
export type TableType = (typeof TABLE_TYPES)[number]

export const TABLE_TYPE_LABELS: Record<TableType, string> = {
  AC: 'AC',
  NON_AC: 'Non-AC',
  OUTDOOR: 'Outdoor',
  OTHER: 'Other'
}

export const TABLE_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'OCCUPIED',
  'KOT_PENDING',
  'PREPARING',
  'READY',
  'BILL_REQUESTED',
  'PAYMENT_PENDING',
  'PAID',
  'BLOCKED'
] as const
export type TableStatus = (typeof TABLE_STATUSES)[number]

/** A table in one of these states has no guests or order attached and can be freely edited or retired. */
export const IDLE_TABLE_STATUSES: readonly TableStatus[] = ['AVAILABLE', 'BLOCKED']

/**
 * Every area is laid out on a grid of cells; a table sits in exactly one cell
 * (position 0,0 is the top-left cell).
 */
export const FLOOR_GRID = { columns: 16, rows: 10 } as const

export const MAX_TABLE_CAPACITY = 50

// --- Response shapes -----------------------------------------------------------------------

export interface AreaSummary {
  id: string
  name: string
  /** Optional floor label such as "Ground floor". */
  floor: string | null
  description: string | null
  sortOrder: number
  isActive: boolean
  tableCount: number
  activeTableCount: number
}

export interface DiningTable {
  id: string
  areaId: string
  areaName: string
  tableNumber: string
  displayName: string
  capacity: number
  type: TableType
  status: TableStatus
  positionX: number
  positionY: number
  isActive: boolean
  /** ISO time the table was opened; null unless guests are seated. */
  openedAt: string | null
  openedByName: string | null
  guestCount: number | null
}

/** An active area with its active tables, as shown on the POS floor. */
export interface FloorArea {
  id: string
  name: string
  floor: string | null
  tables: DiningTable[]
}

// --- Validation ----------------------------------------------------------------------------

const idSchema = z.uuid()

const requiredText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${String(max)} characters.`)

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${String(max)} characters.`)
    .nullish()
    .transform((value) => (value === null || value === undefined || value === '' ? null : value))

const areaFields = {
  name: requiredText('Area name', 60),
  floor: optionalText('Floor', 40),
  description: optionalText('Description', 200),
  sortOrder: z.number().int().min(0).max(999).default(0)
}

export const createAreaInputSchema = z.object(areaFields)
export const updateAreaInputSchema = z.object({ id: idSchema, ...areaFields })

export const setActiveInputSchema = z.object({ id: idSchema, isActive: z.boolean() })

const cell = {
  positionX: z
    .number()
    .int()
    .min(0)
    .max(FLOOR_GRID.columns - 1, 'That spot is outside the floor plan.'),
  positionY: z
    .number()
    .int()
    .min(0)
    .max(FLOOR_GRID.rows - 1, 'That spot is outside the floor plan.')
}

const tableFields = {
  areaId: idSchema,
  tableNumber: requiredText('Table number', 20),
  displayName: optionalText('Display name', 40),
  capacity: z
    .number('Enter how many guests the table seats.')
    .int('Seats must be a whole number.')
    .min(1, 'A table seats at least 1 guest.')
    .max(MAX_TABLE_CAPACITY, `A table seats at most ${String(MAX_TABLE_CAPACITY)} guests.`),
  type: z.enum(TABLE_TYPES)
}

/** Position is optional on create: the table goes to the first free spot in its area. */
export const createTableInputSchema = z.object({
  ...tableFields,
  positionX: cell.positionX.optional(),
  positionY: cell.positionY.optional()
})
export const updateTableInputSchema = z.object({ id: idSchema, ...tableFields })

export const saveLayoutInputSchema = z.object({
  areaId: idSchema,
  positions: z
    .array(z.object({ id: idSchema, ...cell }))
    .min(1)
    .max(FLOOR_GRID.columns * FLOOR_GRID.rows)
})

export const openTableInputSchema = z.object({
  id: idSchema,
  guestCount: z
    .number('Enter the number of guests.')
    .int('Guests must be a whole number.')
    .min(1, 'At least 1 guest is needed.')
    .max(MAX_TABLE_CAPACITY, `At most ${String(MAX_TABLE_CAPACITY)} guests.`)
    .optional()
})

export type CreateAreaInput = z.input<typeof createAreaInputSchema>
export type UpdateAreaInput = z.input<typeof updateAreaInputSchema>
export type SetActiveInput = z.input<typeof setActiveInputSchema>
export type CreateTableInput = z.input<typeof createTableInputSchema>
export type UpdateTableInput = z.input<typeof updateTableInputSchema>
export type SaveLayoutInput = z.input<typeof saveLayoutInputSchema>
export type OpenTableInput = z.input<typeof openTableInputSchema>

export type AreaData = z.output<typeof createAreaInputSchema>
export type UpdateAreaData = z.output<typeof updateAreaInputSchema>
export type SetActiveData = z.output<typeof setActiveInputSchema>
export type CreateTableData = z.output<typeof createTableInputSchema>
export type UpdateTableData = z.output<typeof updateTableInputSchema>
export type SaveLayoutData = z.output<typeof saveLayoutInputSchema>
export type OpenTableData = z.output<typeof openTableInputSchema>
