import type {
  ReportFileResult,
  ReportFilterInput,
  ReportOptions,
  ReportResult
} from '@shared/reports'
import { getApi, unwrap } from '@/lib/ipc'

export const reportsService = {
  run: (filter: ReportFilterInput): Promise<ReportResult> => unwrap(getApi().reports.run(filter)),
  options: (): Promise<ReportOptions> => unwrap(getApi().reports.options()),
  exportCsv: (filter: ReportFilterInput): Promise<ReportFileResult> =>
    unwrap(getApi().reports.exportCsv(filter)),
  exportPdf: (filter: ReportFilterInput): Promise<ReportFileResult> =>
    unwrap(getApi().reports.exportPdf(filter)),
  print: (filter: ReportFilterInput): Promise<null> => unwrap(getApi().reports.print(filter))
}
