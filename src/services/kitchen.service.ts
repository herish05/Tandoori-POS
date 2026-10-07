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
  SetKotStatusInput,
  UpdatePrinterInput
} from '@shared/kitchen'
import { getApi, unwrap } from '@/lib/ipc'

export const kotService = {
  list: (filter: KotFilterInput = {}): Promise<KotSummary[]> => unwrap(getApi().kots.list(filter)),
  get: (id: string): Promise<KotDetail> => unwrap(getApi().kots.get(id)),
  board: (input: KotBoardInput = {}): Promise<KotDetail[]> => unwrap(getApi().kots.board(input)),
  setStatus: (input: SetKotStatusInput): Promise<KotDetail> =>
    unwrap(getApi().kots.setStatus(input)),
  cancel: (input: CancelKotInput): Promise<KotDetail> => unwrap(getApi().kots.cancel(input)),
  preview: (input: KotPreviewInput): Promise<KotPreview> => unwrap(getApi().kots.preview(input)),
  print: (id: string): Promise<KotPrintOutcome> => unwrap(getApi().kots.print(id))
}

export const printerService = {
  list: (): Promise<PrinterConfig[]> => unwrap(getApi().printers.list()),
  create: (input: CreatePrinterInput): Promise<PrinterConfig> =>
    unwrap(getApi().printers.create(input)),
  update: (input: UpdatePrinterInput): Promise<PrinterConfig> =>
    unwrap(getApi().printers.update(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().printers.delete(id)),
  test: (id: string): Promise<PrinterTestOutcome> => unwrap(getApi().printers.test(id)),
  systemDevices: (): Promise<string[]> => unwrap(getApi().printers.systemDevices())
}
