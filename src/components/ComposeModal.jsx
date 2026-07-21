import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const MAX_ATTACH_BYTES = 10 * 1024 * 1024   // 10 MB total, before base64

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M12 2l1.6 4.6L18 8l-4.4 1.4L12 14l-1.6-4.6L6 8l4.4-1.4L12 2zM19 14l.9 2.6L22 17l-2.1.4L19 20l-.9-2.6L16 17l2.1-.4L19 14z" />
    </svg>
  )
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

const formatBytes = (n) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

// Read a File as raw base64 (strip the data: URL prefix). Null on failure.
const readFileB64 = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({ name: file.name, size: file.size, type: file.type || 'application/octet-stream', dataB64: String(reader.result).split(',')[1] || '' })
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })

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
  const [cc, setCc] = useState('')               // reply-all recipients (editable)
  const [replyAll, setReplyAll] = useState(false)
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [intent, setIntent] = useState('')       // one-line note for the AI draft
  const [drafting, setDrafting] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)   // "in reply to" quote
  const [attachments, setAttachments] = useState([])        // { name, size, type, dataB64 }
  const [attachError, setAttachError] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        // Never let the modal sit on "Opening reply…" forever: race the call
        // against a timeout, and always read the hidden non-2xx body so a real
        // error (bad scope, message not found) shows instead of a silent hang.
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 35000))
        const { data, error: fnError } = await Promise.race([
          supabase.functions.invoke('gmail-send', {
            body: { messageId: email.message_id, accountEmail: email.account_email, mode: 'preview' },
          }),
          timeout,
        ])
        if (cancelled) return
        if (fnError || data?.error) {
          let msg = data?.error
          if (fnError) {
            try { const b = await fnError.context?.json?.(); msg = b?.message || b?.error || fnError.message } catch { msg = fnError.message }
          }
          setError(msg || 'Could not open the reply')
        } else {
          setPrefill(data)
          setTo(data.to || '')
          setCc(data.cc || '')
          setSubject(data.subject || '')
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message === 'timeout'
            ? 'Opening the reply timed out. Check your connection and try again.'
            : (e?.message || 'Could not open the reply'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [email.message_id, email.account_email])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Ask Claude to draft the reply body from a one-line intent. It fills the box;
  // Chris always edits and sends himself — nothing goes out from here.
  const draft = async () => {
    if (drafting) return
    setDrafting(true); setError(null)
    const { data, error: fnError } = await supabase.functions.invoke('gmail-draft', {
      body: { messageId: email.message_id, accountEmail: email.account_email, intent },
    })
    if (fnError || data?.error) {
      // supabase-js hides a non-2xx body — read it for the real message.
      let msg = data?.error
      if (fnError) {
        try { const b = await fnError.context?.json?.(); msg = b?.message || b?.error || fnError.message } catch { msg = fnError.message }
      }
      setError(msg || 'Could not draft that reply')
      setDrafting(false)
      return
    }
    setText(data.draft || '')
    setDrafting(false)
  }

  const pickFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''                  // let the same file be re-picked later
    if (!files.length) return
    setAttachError(null)
    const read = (await Promise.all(files.map(readFileB64))).filter(Boolean)
    const current = attachments.reduce((s, a) => s + a.size, 0)
    const added = read.reduce((s, a) => s + a.size, 0)
    if (current + added > MAX_ATTACH_BYTES) {
      setAttachError('Attachments must total under 10 MB.')
      return
    }
    setAttachments(prev => [...prev, ...read])
  }
  const removeAttachment = (i) =>
    setAttachments(prev => prev.filter((_, idx) => idx !== i))

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true); setError(null)
    const { data, error: fnError } = await supabase.functions.invoke('gmail-send', {
      body: {
        messageId: email.message_id,
        accountEmail: email.account_email,
        mode: 'send',
        to, subject, text,
        cc: replyAll ? cc : '',   // only when Reply all is on
        attachments: attachments.map(a => ({ filename: a.name, mimeType: a.type, dataB64: a.dataB64 })),
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

              {/* Reply all — only offered when the original had other recipients.
                  Off by default (reply to the sender); turning it on reveals the
                  Cc so you can see and trim exactly who else gets it. */}
              {prefill.cc && (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-faint w-14 shrink-0" />
                    <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={replyAll}
                        onChange={e => setReplyAll(e.target.checked)}
                        className="w-3.5 h-3.5 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0"
                      />
                      Reply all
                      <span className="text-faint">
                        · also Cc {prefill.cc.split(',').filter(s => s.trim()).length} other{prefill.cc.split(',').filter(s => s.trim()).length === 1 ? '' : 's'}
                      </span>
                    </label>
                  </div>
                  {replyAll && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-faint w-14 shrink-0">Cc</span>
                      <input
                        value={cc}
                        onChange={e => setCc(e.target.value)}
                        className="input flex-1 py-1 text-sm"
                      />
                    </div>
                  )}
                </>
              )}

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
              {/* What you're replying to — a glance at the last message via
                  Gmail's snippet, collapsed by default so it's never in the way. */}
              {email.snippet && (
                <div className="mb-3 rounded-xl border border-line2 bg-surface2/30">
                  <button
                    onClick={() => setShowOriginal(v => !v)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left"
                  >
                    <span className={`text-faint text-xs shrink-0 transition-transform ${showOriginal ? 'rotate-90' : ''}`}>›</span>
                    <span className="text-xs text-muted truncate min-w-0">
                      In reply to <span className="text-fg">{email.sender || 'this message'}</span>
                      {!showOriginal && (
                        <span className="text-faint"> — {email.snippet}</span>
                      )}
                    </span>
                  </button>
                  {showOriginal && (
                    <div className="px-3 pb-3">
                      <div className="max-h-40 overflow-y-auto text-xs text-muted whitespace-pre-wrap leading-relaxed border-t border-line pt-2">
                        {email.snippet}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* AI draft: a one-line intent → Claude fills the reply below. It
                  never sends; Chris edits and hits Send. */}
              <div className="mb-3 rounded-xl border border-line2 bg-surface2/40 p-2.5">
                <div className="flex items-center gap-2">
                  <input
                    value={intent}
                    onChange={e => setIntent(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); draft() } }}
                    placeholder="Tell the AI what to say — e.g. “yes, Tuesday works”"
                    className="input flex-1 py-1.5 text-sm"
                  />
                  <button
                    onClick={draft}
                    disabled={drafting}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-surface2 border border-line2 text-fg font-medium hover:bg-surface transition-colors disabled:opacity-50 shrink-0"
                  >
                    <SparkleIcon />
                    {drafting ? 'Drafting…' : (text ? 'Redraft' : 'Draft')}
                  </button>
                </div>
                <p className="text-[11px] text-faint mt-1.5">
                  Claude reads the email and writes the reply below — you edit and send. Leave blank for a sensible default.
                </p>
              </div>

              <textarea
                autoFocus
                value={text}
                onChange={e => setText(e.target.value)}
                rows={8}
                placeholder="Write your reply, or use Draft above…"
                className="input w-full text-sm resize-none"
              />

              {/* Attachments — up to 10 MB total, sent with the reply. */}
              <div className="mt-2">
                <input ref={fileInputRef} type="file" multiple onChange={pickFiles} className="hidden" />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs text-faint hover:text-fg transition-colors"
                >
                  <PaperclipIcon /> Attach files
                </button>
                {attachError && <p className="text-xs text-muted mt-1.5">{attachError}</p>}
                {attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {attachments.map((a, i) => (
                      <span
                        key={i}
                        className="flex items-center gap-1.5 text-xs bg-surface2 border border-line2 rounded-lg pl-2.5 pr-1.5 py-1"
                      >
                        <PaperclipIcon />
                        <span className="text-fg truncate max-w-[11rem]">{a.name}</span>
                        <span className="text-faint tabular-nums">{formatBytes(a.size)}</span>
                        <button
                          onClick={() => removeAttachment(i)}
                          aria-label={`Remove ${a.name}`}
                          className="w-5 h-5 flex items-center justify-center rounded text-faint hover:text-fg hover:bg-surface transition-colors"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

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
