function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

/* The morning brief, pinned at the top of the dashboard until dismissed. */
export default function MorningBriefCard({ brief, loading, onDismiss }) {
  return (
    <div className="card card-border-accent flex items-start gap-3">
      <span className="text-fg mt-0.5 shrink-0"><SunIcon /></span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-faint uppercase tracking-wider mb-1">Your morning brief</p>
        {loading && !brief ? (
          <p className="text-sm text-muted">Putting together your brief…</p>
        ) : (
          <p className="text-sm text-fg whitespace-pre-wrap leading-relaxed">{brief}</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss brief"
        className="w-7 h-7 flex items-center justify-center rounded-lg text-faint hover:text-fg hover:bg-surface2 transition-colors shrink-0"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
