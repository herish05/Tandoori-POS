import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { AppError } from '../ipc/errors'
import type { ReportOutput } from './output'

const LOAD_TIMEOUT_MS = 30_000

/** A window nobody sees, with the page loaded; always closed afterwards. */
async function withPage<T>(html: string, use: (window: BrowserWindow) => Promise<T>): Promise<T> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, javascript: false }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AppError('NOT_AVAILABLE', 'The report took too long to prepare.'))
      }, LOAD_TIMEOUT_MS)
      window.webContents.once('did-fail-load', () => {
        clearTimeout(timer)
        reject(new AppError('NOT_AVAILABLE', 'The report could not be prepared.'))
      })
      window.webContents.once('did-finish-load', () => {
        clearTimeout(timer)
        resolve()
      })
      window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {
        // did-fail-load reports it.
      })
    })
    return await use(window)
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

/** Saving, PDF and printing through Electron's own dialogs and print engine. */
export function createElectronReportOutput(deps: {
  getWindow: () => BrowserWindow | null
}): ReportOutput {
  return {
    async saveFile({ suggestedName, kind, data }) {
      const options = {
        defaultPath: join(app.getPath('documents'), suggestedName),
        filters:
          kind === 'csv'
            ? [{ name: 'CSV (spreadsheet)', extensions: ['csv'] }]
            : [{ name: 'PDF document', extensions: ['pdf'] }]
      }
      const window = deps.getWindow()
      const chosen = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (chosen.canceled || !chosen.filePath) return { saved: false, path: null }
      await writeFile(chosen.filePath, data)
      return { saved: true, path: chosen.filePath }
    },

    renderPdf(html) {
      return withPage(html, (window) =>
        window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
      )
    },

    print(html) {
      return withPage(
        html,
        (window) =>
          new Promise<void>((resolve, reject) => {
            window.webContents.print(
              { silent: false, printBackground: true },
              (success, reason) => {
                // Closing the dialog without printing is a choice, not a failure.
                if (success || /cancel/i.test(reason)) resolve()
                else reject(new AppError('NOT_AVAILABLE', `Could not print: ${reason}.`))
              }
            )
          })
      )
    }
  }
}
