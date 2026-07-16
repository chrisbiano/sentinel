import { useState } from 'react'
import SectionHeader from './SectionHeader'
import ComposeModal from './ComposeModal'
import ReadModal from './ReadModal'

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

function StarIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

function EmailRow({ email, onAct, onReply, onRead, onReclassify, onFlag, onAddToTasks, busy }) {
  const [confirming, setConfirming] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const moveTargets = BUCKETS.filter(b => b.key !== email.action)
  const taskAdded = Boolean(email.task_created)

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
        </div>
        {/* Flag — floats this to the top of its bucket so it isn't buried. */}
        <button
          onClick={() => onFlag(email)}
          aria-label={email.flagged ? 'Remove flag' : 'Flag'}
          title={email.flagged ? 'Flagged' : 'Flag as important'}
          className={`shrink-0 transition-colors ${
            email.flagged ? 'text-fg' : 'text-faint hover:text-fg'
          }`}
        >
          <StarIcon filled={email.flagged} />
        </button>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            onClick={() => onRead(email)}
            className="text-sm text-muted hover:text-fg truncate mt-0.5 block text-left w-full transition-colors"
          >
            {email.subject || '(no subject)'}
          </button>

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

      <div className="mt-3 pt-3 border-t border-line">
        {/* Row 1 — the "handle it now" actions, kept together on one line. */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onRead(email)}
            className="text-xs px-2.5 py-1 rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
          >
            Read
          </button>
          <button
            onClick={() => onReply(email)}
            className="text-xs px-2.5 py-1 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity"
          >
            Reply
          </button>
          <a
            href={gmailLink(email)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-2.5 py-1 rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
          >
            Open in Gmail
          </a>
          <button
            onClick={() => onAct(email, 'read')}
            className="text-xs px-2.5 py-1 rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
          >
            Mark read
          </button>
        </div>

        {/* Row 2 — deal-with-it-later on the left; organize/remove on the right. */}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {/* "Answer this later" — drops a don't-forget task into Today. Once
              added it greys out for good, so it can't spawn a duplicate. */}
          <button
            onClick={() => onAddToTasks(email)}
            disabled={taskAdded}
            title={taskAdded
              ? "Already in Today's tasks"
              : "Add a reminder to reply, under Today's tasks"}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
              taskAdded
                ? 'border-line text-faint cursor-default'
                : 'border-line2 text-muted hover:text-fg hover:bg-surface2'
            }`}
          >
            {taskAdded ? '✓ Task added' : '+ Task'}
          </button>

          <div className="flex items-center gap-2 ml-auto">
            {email.action === 'unsubscribe' && (
              <button
                onClick={unsubscribe}
                className="text-xs px-2.5 py-1 rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
              >
                Unsubscribe
              </button>
            )}

            {/* Move to a different bucket — the fix when Claude got it wrong. */}
            <div className="relative">
              <button
                onClick={() => setMoveOpen(o => !o)}
                onBlur={() => setTimeout(() => setMoveOpen(false), 150)}
                className="text-xs px-2.5 py-1 rounded-lg border border-line2 text-faint hover:text-fg hover:bg-surface2 transition-colors"
              >
                Move ▾
              </button>
              {moveOpen && (
                <div className="absolute right-0 bottom-full mb-1 z-10 w-36 bg-surface border border-line2 rounded-lg shadow-xl py-1">
                  <p className="text-xs text-faint px-3 py-1">Move to</p>
                  {moveTargets.map(b => (
                    <button
                      key={b.key}
                      onMouseDown={() => { onReclassify(email, b.key); setMoveOpen(false) }}
                      className="block w-full text-left text-xs px-3 py-1.5 text-muted hover:text-fg hover:bg-surface2 transition-colors"
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={trash}
              onBlur={() => setConfirming(false)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                confirming
                  ? 'border-line2 bg-surface2 text-fg'
                  : 'border-line2 text-faint hover:text-fg hover:bg-surface2'
              }`}
            >
              {confirming ? 'Sure? Trash it' : 'Trash'}
            </button>
          </div>
        </div>
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
  onDismiss,
  onReclassify,
  onFlag,
  onAddToTasks,
  onClearError,
}) {
  const [tab, setTab] = useState('reply')
  const [busyKey, setBusyKey] = useState(null)
  const [replyTo, setReplyTo] = useState(null)   // email being composed, or null
  const [reading, setReading] = useState(null)   // email being read, or null

  const counts = Object.fromEntries(
    BUCKETS.map(b => [b.key, emails.filter(e => e.action === b.key).length])
  )
  // Flagged first, newest-first within each group. The source list is already
  // received-desc and JS sort is stable, so this only lifts flagged to the top.
  const shown = emails
    .filter(e => e.action === tab)
    .sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0))
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
              onReply={setReplyTo}
              onRead={setReading}
              onReclassify={onReclassify}
              onFlag={onFlag}
              onAddToTasks={onAddToTasks}
              busy={busyKey === rowKey(email)}
            />
          ))
        )}
      </div>

      {reading && (
        <ReadModal
          email={reading}
          onClose={() => setReading(null)}
          onReply={setReplyTo}
        />
      )}

      {replyTo && (
        <ComposeModal
          email={replyTo}
          onClose={() => setReplyTo(null)}
          onSent={(sent) => {
            // gmail-send already marked it handled server-side, so this is a
            // pure local removal — no gmail-action round-trip.
            onDismiss(sent.message_id, sent.account_email)
            setReplyTo(null)
          }}
        />
      )}
    </section>
  )
}
