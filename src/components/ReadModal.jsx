import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function fullDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/* Read an email in-app — no bouncing to Gmail. Fetches the full body on open
 * and renders it in a sandboxed iframe: scripts, forms, and same-origin access
 * stay blocked, so hostile email markup can't touch Sentinel or the page. The
 * one allowance is user-clicked links opening in a NEW TAB (allow-popups +
 * escape, with <base target="_blank">) — same risk profile as clicking a link
 * in Gmail itself. Reply is one click away without leaving the reader. */
export default function ReadModal({ email, onClose, onReply }) {
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      const { data, error: fnError } = await supabase.functions.invoke('gmail-read', {
        body: { messageId: email.message_id, accountEmail: email.account_email },
      })
      if (cancelled) return
      if (fnError || data?.error) setError((data && data.error) || fnError?.message || 'Could not load the email')
      else setMsg(data)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [email.message_id, email.account_email])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Read email"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl mt-10 sm:mt-0 bg-surface border border-line2 rounded-2xl shadow-xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-line shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-fg truncate">
              {email.subject || '(no subject)'}
            </h2>
            <p className="text-xs text-faint truncate mt-0.5">
              {msg?.sender || email.sender_email}
              {msg?.date && <span> · {fullDate(msg.date)}</span>}
            </p>
            <span className="inline-block mt-1 text-xs text-faint border border-line px-1.5 py-0.5 rounded">
              {email.account_email}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-fg hover:bg-surface2 transition-colors shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-3">
          {loading ? (
            <p className="px-2 py-8 text-center text-sm text-muted">Loading the email…</p>
          ) : error ? (
            <p className="px-2 py-8 text-center text-sm text-fg">{error}</p>
          ) : (
            <iframe
              title="Email content"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"></head><body style="margin:0;padding:12px;background:#fff;">${msg.html}</body></html>`}
              className="w-full h-[55vh] bg-white rounded-lg border border-line"
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => { onReply(email); onClose() }}
            className="px-4 py-1.5 text-sm rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity"
          >
            Reply
          </button>
        </div>
      </div>
    </div>
  )
}
