const COLUMNS = ['New', 'Accepted', 'Preparing', 'Ready'] as const

/** Kitchen display shell: four-column board. Real-time tickets arrive in Phases 6–7. */
export function KitchenPage() {
  return (
    <div className="grid h-full grid-cols-4 gap-4">
      {COLUMNS.map((title) => (
        <section
          key={title}
          aria-label={`${title} tickets`}
          className="flex min-h-0 flex-col rounded-lg bg-white/5"
        >
          <h2 className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-sm font-bold uppercase tracking-wider">
            {title}
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">0</span>
          </h2>
          <div className="flex flex-1 items-center justify-center p-4 text-sm text-navy-foreground/50">
            No tickets
          </div>
        </section>
      ))}
    </div>
  )
}
