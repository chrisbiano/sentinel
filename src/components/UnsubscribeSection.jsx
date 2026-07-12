import SectionHeader from './SectionHeader'

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  )
}

export default function UnsubscribeSection({ suggestions, onApprove, onReject }) {
  const pending = suggestions.filter(s => s.status === 'pending')
  const processed = suggestions.filter(s => s.status !== 'pending')

  return (
    <section>
      <SectionHeader
        icon={<SparkleIcon />}
        title="Suggested unsubscribes"
        count={pending.length}
      />

      {/* Pending Suggestions */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-faint uppercase tracking-wider mb-3">Awaiting your review</h3>
          <div className="space-y-3 mb-6">
            {pending.map(suggestion => (
              <div
                key={suggestion.id}
                className="card card-hover"
              >
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-fg">{suggestion.from}</h3>
                    <p className="text-faint text-sm mt-1">{suggestion.sender}</p>
                    <p className="text-muted text-sm mt-2">{suggestion.reason}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => onApprove(suggestion.id)}
                      className="px-4 py-2 bg-accent text-accent-fg rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => onReject(suggestion.id)}
                      className="px-4 py-2 bg-transparent border border-line2 text-fg rounded-lg font-medium hover:bg-surface2 transition-colors text-sm"
                    >
                      Keep
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Processed */}
      {processed.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-faint uppercase tracking-wider mb-3">Recently processed</h3>
          <div className="space-y-2">
            {processed.map(suggestion => (
              <div
                key={suggestion.id}
                className="card"
              >
                <div className="flex justify-between items-center gap-4">
                  <div className="min-w-0">
                    <h3 className="font-medium text-muted">{suggestion.from}</h3>
                    <p className="text-faint text-sm">{suggestion.sender}</p>
                  </div>
                  <span
                    className={`text-sm font-medium px-3 py-1 rounded-full border shrink-0 ${
                      suggestion.status === 'approved'
                        ? 'bg-surface2 border-line2 text-fg'
                        : 'bg-transparent border-line text-faint'
                    }`}
                  >
                    {suggestion.status === 'approved' ? 'Approved' : 'Kept'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending.length === 0 && processed.length === 0 && (
        <div className="card">
          <p className="text-muted">No unsubscribe suggestions at this time.</p>
        </div>
      )}
    </section>
  )
}
