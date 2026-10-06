import { Maximize, Minimize, Minus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import { systemService } from '@/services/system.service'
import type { WindowState } from '@shared/types'

/** Minimize / fullscreen / close for the native window (used by POS fullscreen mode). */
export function WindowControls({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const [state, setState] = useState<WindowState | null>(null)

  useEffect(() => {
    if (!window.tandoori) return
    let active = true
    systemService
      .getWindowState()
      .then((s) => {
        if (active) setState(s)
      })
      .catch((error: unknown) => {
        logger.warn('Could not read window state', { error })
      })
    const off = systemService.onWindowStateChanged((s) => {
      setState(s)
    })
    return () => {
      active = false
      off()
    }
  }, [])

  if (!window.tandoori) return null

  const run = (action: () => Promise<unknown>) => () => {
    action().catch((error: unknown) => {
      logger.error('Window action failed', { error })
    })
  }
  const ghost = tone === 'dark' ? 'text-navy-foreground hover:bg-white/10 hover:text-white' : ''

  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon"
        className={ghost}
        aria-label="Minimize window"
        onClick={run(systemService.minimize)}
      >
        <Minus />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={ghost}
        aria-label={state?.isFullScreen ? 'Exit full screen' : 'Enter full screen'}
        onClick={run(systemService.toggleFullscreen)}
      >
        {state?.isFullScreen ? <Minimize /> : <Maximize />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={ghost}
        aria-label="Close application"
        onClick={run(systemService.close)}
      >
        <X />
      </Button>
    </div>
  )
}
