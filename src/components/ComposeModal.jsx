import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

/* Reply to an email as Chris, in a Gmail-style composer.
 *
 * On open it asks the server for a preview: the correct From identity, the
 * reply-to address, the "Re:" subject, and — the non-negotiable — his real
 * Gmail signature HTML. The signature renders below the body exactly as it will
 * send, so there's no "did my signature make it?" doubt. He types the message;
 * the signature is appended untouched server-side.
 *
 * Send is real and irreversible by design — no confirm dialog. The visible From
 * line is the safety: you can always see which of six identities this goes out
 * as before you click. */
export default function ComposeModal({ email, onClose, onSent }) {
  const [loading, setLoading] = useState(true)
  const [prefill, setPrefill] = useState(null)   // { from, to, subject, signatureHtml }
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      const { data, error: fnError } = await supabase.functions.invoke('gmail-send', {
        body: { messageId: email.message_id, accountEmail: email.account_email, mode: 'preview' },
      })
      if (cancelled) return
      if (fnError || data?.error) {
        setError((data && data.error) || fnError?.message || 'Could not open the reply')
      } else {
        setPrefill(data)
        setTo(data.to || '')
        setSubject(data.subject || '')
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [email.message_id, email.account_email])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true); setError(null)
    const { data, error: fnError } = await supabase.functions.invoke('gmail-send', {
      body: {
        messageId: email.message_id,
        accountEmail: email.account_email,
        mode: 'send',
        to, subject, text,
      },
    })
    if (fnError || data?.error) {
      setError((data && data.error) || fnError?.message || 'Send failed')
      setSending(false)
      return
    }
    onSent(email)   // drop it from the list; it's handled
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reply"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl mt-10 sm:mt-0 bg-surface border border-line2 rounded-2xl shadow-xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-line shrink-0">
          <h2 className="text-sm font-medium text-fg">Reply</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-fg hover:bg-surface2 transition-colors"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-muted">Opening reply…</div>
        ) : error && !prefill ? (
          <div className="px-5 py-8">
            <p className="text-sm text-fg mb-3">{error}</p>
            <p className="text-xs text-faint">
              If this says no send permission, reconnect this account in Settings to grant it.
            </p>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 space-y-2 border-b border-line shrink-0 text-sm">
              {/* From is shown, not editable — the reply goes out as the mailbox
                  it arrived on. Seeing it is the guardrail against a wrong-identity send. */}
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-faint w-14 shrink-0">From</span>
                <span className="text-fg">{prefill.from}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-faint w-14 shrink-0">To</span>
                <input
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  className="input flex-1 py-1 text-sm"
                />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-faint w-14 shrink-0">Subject</span>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="input flex-1 py-1 text-sm"
                />
              </div>
            </div>

            <div className="px-5 py-3 overflow-y-auto flex-1">
              <textarea
                autoFocus
                value={text}
                onChange={e => setText(e.target.value)}
                rows={8}
                placeholder="Write your reply…"
                className="input w-full text-sm resize-none"
              />

              {/* The real signature, exactly as it will send. Rendered, not
                  editable — this is the "it's really there" proof Chris wanted. */}
              {prefill.signatureHtml ? (
                <div className="mt-3 pt-3 border-t border-line">
                  <p className="text-xs text-faint mb-2">Your signature (sent automatically):</p>
                  <div
                    className="text-sm text-muted opacity-90 [&_a]:text-fg [&_img]:max-w-full [&_img]:h-auto"
                    dangerouslySetInnerHTML={{ __html: prefill.signatureHtml }}
                  />
                </div>
              ) : (
                <p className="mt-3 pt-3 border-t border-line text-xs text-muted">
                  No Gmail signature found for this account — the reply will send without one.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-line shrink-0">
              <span className="text-xs text-faint min-w-0 truncate">
                {error ? <span className="text-fg">{error}</span> : 'Sends immediately — no undo.'}
              </span>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-sm rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={send}
                  disabled={!text.trim() || sending}
                  className="px-4 py-1.5 text-sm rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
