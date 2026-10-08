import type { ReportFileResult } from '@shared/reports'

/**
 * Where a report goes once it is worked out: a file the person picks, a PDF or a printer. The only
 * part of reporting that touches Electron, so everything else can be tested without a window.
 */
export interface ReportOutput {
  /** Asks where to save, then writes the data. `saved` is false when the person cancels. */
  saveFile: (file: {
    suggestedName: string
    kind: 'csv' | 'pdf'
    data: string | Buffer
  }) => Promise<ReportFileResult>
  /** Draws a page of HTML as a PDF. */
  renderPdf: (html: string) => Promise<Buffer>
  /** Opens the system print dialog for a page of HTML. Resolves when it closes. */
  print: (html: string) => Promise<void>
}
