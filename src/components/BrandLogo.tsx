import { cn } from '@/lib/utils'

interface BrandLogoProps {
  /** Show the "Tandoori-POS" wordmark next to the mark. */
  showWordmark?: boolean
  className?: string
  /** Wordmark colour; use `light` on dark backgrounds. */
  tone?: 'dark' | 'light'
}

/** Tandoori-POS mark: a tandoor flame inside a rounded tile. Original artwork. */
export function BrandLogo({ showWordmark = true, className, tone = 'dark' }: BrandLogoProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <svg
        viewBox="0 0 40 40"
        className="size-9 shrink-0"
        role="img"
        aria-label="Tandoori-POS logo"
      >
        <rect width="40" height="40" rx="9" fill="hsl(355 70% 42%)" />
        <path
          d="M20 6c1.2 4.2 5.6 6.6 7.6 11 1.9 4.2.6 9.4-3 12.2-1 .8-2.2 1.3-3.4 1.6 2-2.2 2.6-5 1.4-7.6-.6-1.4-1.7-2.4-2.6-3.6-.4 2.2-1.6 3.6-3 4.8-1.8 1.6-2.8 3.8-2.2 6-3.6-1.8-5.4-6-4.2-10C12.8 15 18 12.4 20 6Z"
          fill="#fff"
        />
        <path d="M11 33.5h18" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".85" />
      </svg>
      {showWordmark && (
        <span
          className={cn(
            'text-lg font-extrabold tracking-tight',
            tone === 'light' ? 'text-white' : 'text-foreground'
          )}
        >
          Tandoori<span className="text-primary">-POS</span>
        </span>
      )}
    </div>
  )
}
