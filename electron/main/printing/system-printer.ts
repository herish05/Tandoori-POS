import { BrowserWindow, type WebContents } from 'electron'
import { PAPER_WIDTHS } from '@shared/kitchen'
import { PrintError, type PrinterDriver, type PrinterTarget, type PrintPayload } from './drivers'

const PRINT_TIMEOUT_MS = 30_000

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The document as a small monospace page sized to the paper. */
export function buildPrintHtml(target: PrinterTarget, payload: PrintPayload): string {
  const width = PAPER_WIDTHS.includes(target.paperWidth) ? target.paperWidth : 80
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(payload.title)}</title>
<style>
@page { size: ${String(width)}mm auto; margin: 0 }
body { margin: 0; padding: 2mm; width: ${String(width - 4)}mm }
pre { margin: 0; font: 11px/1.25 "DejaVu Sans Mono", "Courier New", monospace; white-space: pre-wrap }
</style></head><body><pre>${escapeHtml(payload.lines.join('\n'))}</pre></body></html>`
}

/**
 * Prints through the operating system's own printer list (USB, Bluetooth, shared, PDF). The
 * only place the app touches Electron's printing; everything else works on the driver interface.
 */
export function createSystemPrinterDriver(deps: {
  getWebContents: () => WebContents | null
}): PrinterDriver {
  return {
    async listDevices() {
      const contents = deps.getWebContents()
      if (!contents) return []
      const printers = await contents.getPrintersAsync()
      return printers.map((printer) => printer.name)
    },

    print(target, payload) {
      return new Promise<void>((resolve, reject) => {
        const window = new BrowserWindow({
          show: false,
          webPreferences: { sandbox: true, contextIsolation: true, javascript: false }
        })
        const done = (error?: PrintError): void => {
          clearTimeout(timer)
          if (!window.isDestroyed()) window.destroy()
          if (error) reject(error)
          else resolve()
        }
        const timer = setTimeout(() => {
          done(new PrintError(`${target.name} did not respond in time.`))
        }, PRINT_TIMEOUT_MS)

        window.webContents.once('did-fail-load', () => {
          done(new PrintError('The ticket could not be prepared for printing.'))
        })
        window.webContents.once('did-finish-load', () => {
          window.webContents.print(
            {
              silent: true,
              deviceName: target.address,
              printBackground: false,
              margins: { marginType: 'none' }
            },
            (success, failureReason) => {
              done(
                success
                  ? undefined
                  : new PrintError(
                      `Could not print to ${target.name}: ${failureReason || 'the printer refused the job'}.`
                    )
              )
            }
          )
        })
        void window
          .loadURL(
            `data:text/html;charset=utf-8,${encodeURIComponent(buildPrintHtml(target, payload))}`
          )
          .catch(() => {
            // did-fail-load reports it.
          })
      })
    }
  }
}
