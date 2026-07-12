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

export default function EmailSection({ emails, onReply }) {
  const replyEmails = emails.filter(e => e.needsReply)
  const [replyingTo, setReplyingTo] = useState(null)
  const [draft, setDraft] = useState('')

  const openReply = (id) => {
    setReplyingTo(id)
    setDraft('')
  }

  const send = (id) => {
    onReply(id)
    setReplyingTo(null)
    setDraft('')
  }

  return (
    <section>
      <SectionHeader
        icon={<MailIcon />}
        title="Emails needing reply"
        count={replyEmails.length}
      />

      <div className="space-y-3">
        {replyEmails.length === 0 ? (
          <div className="card">
            <p className="text-muted">No emails need replies. You're all caught up!</p>
          </div>
        ) : (
          replyEmails.map(email => (
            <div key={email.id} className="card">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-medium text-fg">{email.from}</h3>
                    {email.unread && (
                      <span className="w-1.5 h-1.5 bg-fg rounded-full"></span>
                    )}
                  </div>
                  <p className="text-muted mb-1">{email.subject}</p>
                  <p className="text-faint text-sm">{email.preview}</p>
                  <div className="flex items-center gap-3 mt-3">
                    <span className="text-faint text-xs">{email.timestamp}</span>
                    {email.flagged && (
                      <span className="text-xs text-muted border border-line2 px-2 py-0.5 rounded-full">
                        Flagged sender
                      </span>
                    )}
                  </div>
                </div>
                {replyingTo !== email.id && (
                  <button
                    onClick={() => openReply(email.id)}
                    className="px-3 py-1.5 text-sm bg-accent text-accent-fg rounded-lg font-medium hover:opacity-90 transition-opacity shrink-0"
                  >
                    Reply
                  </button>
                )}
              </div>

              {replyingTo === email.id && (
                <div className="mt-3 pt-3 border-t border-line">
                  <textarea
                    autoFocus
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    rows={3}
                    placeholder={`Reply to ${email.from}…`}
                    className="input w-full resize-none"
                  />
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-faint">Demo — no email is actually sent</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setReplyingTo(null)}
                        className="px-3 py-1.5 text-sm rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => send(email.id)}
                        disabled={!draft.trim()}
                        className="px-3 py-1.5 text-sm rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                      >
                        Send
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
