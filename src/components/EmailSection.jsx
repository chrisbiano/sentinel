import { useState } from 'react'
import SectionHeader from './SectionHeader'

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" />
    </svg>
  )
}

/* The four things you can do with an email. Ordered by how much they want from
   you, so the tab bar reads left-to-right as "most demanding first". */
const BUCKETS = [
  { key: 'reply', label: 'Reply', blurb: 'Someone is waiting on you.' },
  { key: 'read', label: 'Read', blurb: 'Worth knowing. Nothing to do.' },
  { key: 'unsubscribe', label: 'Unsubscribe', blurb: 'Recurring mail you don’t read.' },
  { key: 'junk', label: 'Junk', blurb: 'Noise. Safe to trash.' },
]

function timeAgo(iso) {
  if (!iso) return ''
  const mins = Math.round((Date.now() - new Date(iso)) / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// Gmail accepts the address in /u/, which is what makes this work across six
// signed-in accounts without landing in the wrong mailbox.
const gmailLink = (email) =>
  `https://mail.google.com/mail/u/${encodeURIComponent(email.account_email)}/#inbox/${email.thread_id || email.message_id}`

function EmailRow({ email, onAct, busy }) {
  const [confirming, setConfirming] = useState(false)

  const trash = () => {
    if (!confirming) { setConfirming(true); return }
    setConfirming(false)
    onAct(email, 'trash')
  }

  const unsubscribe = async () => {
    const res = await onAct(email, 'unsubscribe')
    // No RFC 8058 endpoint — hand it off rather than guessing at a link.
    if (res && res.oneClick === false) {
      if (email.unsubscribe_url) window.open(email.unsubscribe_url, '_blank', 'noopener')
      else window.open(gmailLink(email), '_blank', 'noopener')
    }
  }

  return (
    <div className={`card ${busy ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-sm text-fg truncate">{email.sender || email.sender_email}</h3>
            <span className="text-xs text-faint shrink-0">{timeAgo(email.received_at)}</span>
          </div>
          <p className="text-sm text-muted truncate mt-0.5">{email.subject || '(no subject)'}</p>

          {/* Claude's reasoning, in its own words. This is the part you audit. */}
          {email.reason && (
            <p className="text-xs text-faint mt-1.5 italic">{email.reason}</p>
          )}

          {/* With six mailboxes, which one this landed in is not a detail. */}
          <span className="inline-block mt-2 text-xs text-faint border border-line px-1.5 py-0.5 rounded">
            {email.account_email}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line flex-wrap">
        <a
          href={gmailLink(email)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-2.5 py-1 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity"
        >
          Open in Gmail
        </a>
        <button
          onClick={() => onAct(email, 'read')}
          className="text-xs px-2.5 py-1 rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
        >
          Mark read
        </button>
        {email.action === 'unsubscribe' && (
          <button
            onClick={unsubscribe}
            className="text-xs px-2.5 py-1 rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
          >
            Unsubscribe
          </button>
        )}
        <button
          onClick={trash}
          onBlur={() => setConfirming(false)}
          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ml-auto ${
            confirming
              ? 'border-line2 bg-surface2 text-fg'
              : 'border-line2 text-faint hover:text-fg hover:bg-surface2'
          }`}
        >
          {confirming ? 'Sure? Trash it' : 'Trash'}
        </button>
      </div>
    </div>
  )
}

/* Every email from every connected account, sorted by Claude into what you'd do
   with it. Claude only ever sorts — nothing here happens until you click. */
export default function EmailSection({
  emails = [],
  loading,
  remaining,
  error,
  accountErrors = [],
  onAct,
  onClearError,
}) {
  const [tab, setTab] = useState('reply')
  const [busyKey, setBusyKey] = useState(null)

  const counts = Object.fromEntries(
    BUCKETS.map(b => [b.key, emails.filter(e => e.action === b.key).length])
  )
  const shown = emails.filter(e => e.action === tab)
  const active = BUCKETS.find(b => b.key === tab)

  // Gmail ids only identify a message within one mailbox, so every key here is
  // mailbox + id — otherwise two accounts could shadow each other in the list.
  const rowKey = (e) => `${e.account_email} ${e.message_id}`

  const act = async (email, action) => {
    setBusyKey(rowKey(email))
    const res = await onAct(email.message_id, email.account_email, action)
    setBusyKey(null)
    return res
  }

  return (
    <section>
      <SectionHeader
        icon={<MailIcon />}
        title="Inbox"
        count={counts.reply}
      />

      {/* Failures here are silent otherwise — you'd just see an empty inbox and
          assume you were caught up. */}
      {error && (
        <div className="card card-border-accent flex items-center justify-between gap-4 mb-3">
          <p className="text-sm text-fg">{error}</p>
          <button onClick={onClearError} className="text-xs text-faint hover:text-fg transition-colors shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {/* An account connected before Gmail was wired reports zero mail, which
          looks identical to an empty inbox. Name it instead. */}
      {accountErrors.length > 0 && (
        <div className="card mb-3">
          <p className="text-xs text-muted mb-1">Some accounts didn’t report in:</p>
          <ul className="space-y-0.5">
            {accountErrors.map(msg => (
              <li key={msg} className="text-xs text-faint">· {msg}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-1 mb-3 overflow-x-auto">
        {BUCKETS.map(b => (
          <button
            key={b.key}
            onClick={() => setTab(b.key)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              tab === b.key
                ? 'bg-surface2 text-fg border border-line2'
                : 'text-muted hover:text-fg border border-transparent'
            }`}
          >
            {b.label}
            <span className="ml-1.5 text-faint tabular-nums">{counts[b.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <p className="text-xs text-faint mb-3">
        {loading
          ? remaining > 0
            ? `Reading your mail — ${remaining} left to sort…`
            : 'Reading your mail…'
          : active.blurb}
      </p>

      <div className="space-y-3">
        {shown.length === 0 ? (
          <div className="card">
            <p className="text-muted text-sm">
              {loading
                ? 'Sorting…'
                : tab === 'reply'
                  ? 'Nobody’s waiting on you. You’re caught up.'
                  : `Nothing in ${active.label.toLowerCase()}.`}
            </p>
          </div>
        ) : (
          shown.map(email => (
            <EmailRow
              key={rowKey(email)}
              email={email}
              onAct={act}
              busy={busyKey === rowKey(email)}
            />
          ))
        )}
      </div>
    </section>
  )
}
