import { IPC_CHANNELS } from '@shared/ipc-channels'
import { emptyInputSchema } from '@shared/schemas'
import { reportFilterSchema } from '@shared/reports'
import type { IpcRegistrar } from './ipc/registrar'
import type { ReportOutput } from './reports/output'
import type { Services } from './services'

const REPORTS_VIEW = { permissions: ['reports.view'] } as const
const REPORTS_EXPORT = { permissions: ['reports.export'] } as const

/** Report handlers. Saving and printing go through `output`, so tests can stand in for Electron. */
export function registerReportHandlers(
  registrar: IpcRegistrar,
  services: Services,
  output: ReportOutput
): void {
  const { reports } = services

  registrar.handleProtected(IPC_CHANNELS.reportsRun, reportFilterSchema, REPORTS_VIEW, (input) =>
    reports.run(input)
  )
  registrar.handleProtected(IPC_CHANNELS.reportsOptions, emptyInputSchema, REPORTS_VIEW, () =>
    reports.options()
  )
  registrar.handleProtected(
    IPC_CHANNELS.reportsExportCsv,
    reportFilterSchema,
    REPORTS_EXPORT,
    async (input, auth) => {
      const file = reports.exportCsv(input)
      const saved = await output.saveFile({
        suggestedName: file.filename,
        kind: 'csv',
        data: file.content
      })
      if (saved.saved) reports.recordExport(auth, input, 'csv')
      return saved
    }
  )
  registrar.handleProtected(
    IPC_CHANNELS.reportsExportPdf,
    reportFilterSchema,
    REPORTS_EXPORT,
    async (input, auth) => {
      const page = reports.renderPage(input)
      const pdf = await output.renderPdf(page.html)
      const saved = await output.saveFile({
        suggestedName: `${page.stem}.pdf`,
        kind: 'pdf',
        data: pdf
      })
      if (saved.saved) reports.recordExport(auth, input, 'pdf')
      return saved
    }
  )
  registrar.handleProtected(
    IPC_CHANNELS.reportsPrint,
    reportFilterSchema,
    REPORTS_EXPORT,
    async (input, auth) => {
      await output.print(reports.renderPage(input).html)
      reports.recordExport(auth, input, 'print')
      return null
    }
  )
}
