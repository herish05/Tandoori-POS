import { z } from 'zod'

/**
 * Advanced table operations: shifting a running order to another table and merging two running
 * tables into one. Shared by the renderer (labels, instant feedback) and the main process.
 */

export const TABLE_OPERATION_KINDS = ['SHIFT', 'MERGE'] as const
export type TableOperationKind = (typeof TABLE_OPERATION_KINDS)[number]

export const TABLE_OPERATION_LABELS: Record<TableOperationKind, string> = {
  SHIFT: 'Table shifted',
  MERGE: 'Tables merged'
}

const idSchema = z.uuid()

/** Moves the guests of a running order to a free table. */
export const shiftTableInputSchema = z.object({
  orderId: idSchema,
  toTableId: idSchema
})

/** Folds the running order of one table into the running order of another. */
export const mergeTablesInputSchema = z
  .object({
    /** The order that is folded in and closed; its table becomes free. */
    sourceOrderId: idSchema,
    /** The order that carries on with everything from both tables. */
    targetOrderId: idSchema
  })
  .refine((value) => value.sourceOrderId !== value.targetOrderId, {
    path: ['targetOrderId'],
    message: 'Choose two different tables.'
  })

export type ShiftTableInput = z.input<typeof shiftTableInputSchema>
export type ShiftTableData = z.output<typeof shiftTableInputSchema>
export type MergeTablesInput = z.input<typeof mergeTablesInputSchema>
export type MergeTablesData = z.output<typeof mergeTablesInputSchema>
