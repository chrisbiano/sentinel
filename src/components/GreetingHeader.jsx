export default function GreetingHeader({ onReviewAll, onDismiss }) {
  const now = new Date()
  const hour = now.getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateLabel = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="bg-surface border border-line rounded-2xl px-5 sm:px-6 py-4 sm:py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <div className="flex items-center gap-1.5 text-muted text-xs mb-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-fg/70 animate-pulse"></span>
          Synced just now
        </div>
        <h2 className="text-xl sm:text-2xl font-medium tracking-tight text-fg">{greeting}, Chris</h2>
        <p className="text-muted text-sm mt-0.5">
          {dateLabel} · Here's what needs your attention
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onReviewAll}
          className="px-4 py-2 bg-accent text-accent-fg rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
        >
          Review all
        </button>
        <button
          onClick={onDismiss}
          className="px-4 py-2 bg-transparent text-fg rounded-lg font-medium text-sm hover:bg-surface2 transition-colors border border-line2"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
