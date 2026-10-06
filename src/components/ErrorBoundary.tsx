import { AlertTriangle } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Short name of the area, written to the log to speed up diagnosis. */
  scope?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('React render error', {
      scope: this.props.scope ?? 'app',
      error,
      componentStack: info.componentStack
    })
  }

  private readonly reset = (): void => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return <ErrorFallback onRetry={this.reset} />
  }
}

export function ErrorFallback({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex h-full min-h-60 flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <AlertTriangle className="size-12 text-warning" aria-hidden />
      <div className="space-y-1">
        <h2 className="text-xl font-bold">This screen ran into a problem</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Your data is safe. Details have been recorded in the application log. You can try again,
          or reload the application if the problem continues.
        </p>
      </div>
      <div className="flex gap-2">
        {onRetry && <Button onClick={onRetry}>Try again</Button>}
        <Button
          variant="outline"
          onClick={() => {
            window.location.reload()
          }}
        >
          Reload application
        </Button>
      </div>
    </div>
  )
}
