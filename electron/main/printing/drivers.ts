import net from 'node:net'
import { DEFAULT_NETWORK_PRINTER_PORT, type PaperWidth, type PrinterKind } from '@shared/kitchen'

/** What a driver needs to know about the printer it prints to. */
export interface PrinterTarget {
  name: string
  address: string
  paperWidth: PaperWidth
}

/** One document in every form a driver may need. */
export interface PrintPayload {
  title: string
  columns: number
  /** Plain text lines (operating-system printers). */
  lines: string[]
  /** ESC/POS bytes (thermal printers). */
  escpos: Buffer
}

export interface PrinterDriver {
  /** Resolves when the printer has accepted the document; rejects with a staff-readable message. */
  print(target: PrinterTarget, payload: PrintPayload): Promise<void>
  /** The printers this driver can see, if it can list them. */
  listDevices?(): Promise<string[]>
}

export type PrinterDrivers = Partial<Record<PrinterKind, PrinterDriver>>

/** A failure to print, worded for the person at the counter. */
export class PrintError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrintError'
  }
}

export function parseNetworkAddress(address: string): { host: string; port: number } {
  const [host = '', rawPort] = address.trim().split(':')
  const port = rawPort ? Number(rawPort) : DEFAULT_NETWORK_PRINTER_PORT
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PrintError(`"${address}" is not a valid printer address.`)
  }
  return { host, port }
}

const NETWORK_ERRORS: Record<string, string> = {
  ECONNREFUSED: 'the printer refused the connection. Check that it is on and the port is right',
  ETIMEDOUT: 'the printer did not answer in time',
  EHOSTUNREACH: 'the printer cannot be reached on the network',
  ENETUNREACH: 'this computer is not on the same network as the printer',
  ENOTFOUND: 'the printer name was not found on the network',
  ECONNRESET: 'the printer closed the connection',
  EPIPE: 'the printer closed the connection'
}

/** Sends ESC/POS bytes to a thermal printer's raw port (usually 9100). */
export class NetworkPrinterDriver implements PrinterDriver {
  constructor(private readonly timeoutMs = 5000) {}

  print(target: PrinterTarget, payload: PrintPayload): Promise<void> {
    const { host, port } = parseNetworkAddress(target.address)
    const where = `${host}:${String(port)}`
    return new Promise<void>((resolve, reject) => {
      const socket = new net.Socket()
      let settled = false
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        socket.destroy()
        const code = (error as NodeJS.ErrnoException).code
        const reason =
          (code ? NETWORK_ERRORS[code] : undefined) ??
          (error instanceof Error && error.message === 'timeout'
            ? NETWORK_ERRORS.ETIMEDOUT
            : 'an unexpected network error happened')
        reject(new PrintError(`Could not print to ${target.name} (${where}): ${reason ?? ''}.`))
      }
      socket.setTimeout(this.timeoutMs, () => {
        fail(new Error('timeout'))
      })
      socket.once('error', fail)
      socket.once('close', () => {
        if (settled) return
        settled = true
        resolve()
      })
      socket.connect(port, host, () => {
        socket.write(payload.escpos, (error) => {
          if (error) fail(error)
          else socket.end()
        })
      })
    })
  }
}
