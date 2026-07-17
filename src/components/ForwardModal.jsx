import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/* Forward an email from inside Sentinel, with Gmail-style recipient
 * autocomplete: as you type a name, it searches the people you've emailed on
 * this account and lets you pick — or you can just type a full address.
 *
 * The forward carries the original message quoted below your note, plus your
 * signature, and goes out as a new thread. Send is real and immediate. */
export default function ForwardModal({ email, onClose, onSent }) {
  const fwdSubject = email.subject
    ? (/^fwd:/i.test(email.subject) ? email.subject : `Fwd: ${email.subject}`)
    : 'Fwd:'

  const [query, setQuery] = useState('')       // what's typed in the To field
  const [to, setTo] = useState('')             // the picked recipient email
  const [suggestions, setSuggestions] = useState([])
  const [searching, setSearching] = useState(false)
  const [contactNote, setContactNote] = useState(null)   // why the list is empty
  const [subject, setSubject] = useState(fwdSubject)
  const [text, setText] = useState('')
  const [signatureHtml, setSignatureHtml] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const debounce = useRef(null)

  useEffect(() => {
    let cancelled = false
    supabase.functions
      .invoke('gmail-send', { body: { accountEmail: email.account_email, mode: 'signature' } })
      .then(({ data }) => { if (!cancelled && data && !data.error) setSignatureHtml(data.signatureHtml || '') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [email.account_email])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onQueryChange = (v) => {
    setQuery(v)
    setTo('')                                  // typing invalidates a prior pick
    setContactNote(null)
    if (debounce.current) clearTimeout(debounce.current)
    if (v.trim().length < 2) { setSuggestions([]); setSearching(false); return }
    setSearching(true)
    debounce.current = setTimeout(async () => {
      const { data, error: fnError } = await supabase.functions.invoke('contacts-search', {
        body: { accountEmail: email.account_email, query: v.trim() },
      })
      const list = data?.contacts ?? []
      setSuggestions(list)
      // Surface why it's empty so an empty dropdown isn't a silent mystery.
      if (fnError) setContactNote('Contact search failed — you can still type a full email.')
      else if (data?.error) setContactNote(data.error)
      else if (list.length === 0) setContactNote('No matches — type the full email address.')
      else setContactNote(null)
      setSearching(false)
    }, 250)
  }

  const pick = (c) => {
    setTo(c.email)
    setQuery(c.name && c.name !== c.email ? `${c.name} <${c.email}>` : c.email)
    setSuggestions([])
  }

  // Recipient is the picked address, or an email parsed from what was typed.
  const resolvedTo = () => {
    if (to) return to
    const q = query.trim()
    const m = q.match(/<([^>]+)>/)
    if (m) return m[1].trim()
    if (/^\S+@\S+\.\S+$/.test(q)) return q
    return ''
  }

  const send = async () => {
    const recipient = resolvedTo()
    if (!recipient) { setError('Pick a recipient from the list, or type a full email address.'); return }
    setSending(true); setError(null)
    const { data, error: fnError } = await supabase.functions.invoke('gmail-send', {
      body: { messageId: email.message_id, accountEmail: email.account_email, mode: 'forward', to: recipient, text },
    })
    if (fnError || data?.error) {
      setError((data && data.error) || fnError?.message || 'Forward failed')
      setSending(false)
      return
    }
    onSent()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Forward"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl mt-10 sm:mt-0 bg-surface border border-line2 rounded-2xl shadow-xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-line shrink-0">
          <h2 className="text-sm font-medium text-fg">Forward</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-fg hover:bg-surface2 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-3 space-y-2 border-b border-line shrink-0 text-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-faint w-14 shrink-0">From</span>
            <span className="text-fg truncate">{email.account_email}</span>
          </div>
          {/* Autocomplete recipient */}
          <div className="flex items-start gap-2 relative">
            <span className="text-xs text-faint w-14 shrink-0 pt-2">To</span>
            <div className="flex-1 relative">
              <input
                autoFocus
                value={query}
                onChange={e => onQueryChange(e.target.value)}
                placeholder="Type a name or email…"
                className="input w-full py-1 text-sm"
              />
              {query.trim().length >= 2 && !to && (
                <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-surface border border-line2 rounded-lg shadow-xl max-h-52 overflow-y-auto">
                  {searching ? (
                    <p className="text-xs text-faint px-3 py-2">Searching contacts…</p>
                  ) : suggestions.length > 0 ? (
                    suggestions.map(c => (
                      <button
                        key={c.email}
                        onMouseDown={() => pick(c)}
                        className="block w-full text-left px-3 py-2 hover:bg-surface2 transition-colors"
                      >
                        <span className="text-sm text-fg">{c.name}</span>
                        {c.name !== c.email && (
                          <span className="block text-xs text-faint">{c.email}</span>
                        )}
                      </button>
                    ))
                  ) : (
                    <p className="text-xs text-muted px-3 py-2">{contactNote || 'No matches.'}</p>
                  )}
                </div>
              )}
            </div>
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
            value={text}
            onChange={e => setText(e.target.value)}
            rows={5}
            placeholder="Add a note (optional)…"
            className="input w-full text-sm resize-none"
          />
          <p className="text-xs text-faint mt-3">
            The full original message and your signature are included below your note.
          </p>
          {signatureHtml && (
            <div className="mt-2 pt-2 border-t border-line">
              <div
                className="text-sm text-muted opacity-90 [&_a]:text-fg [&_img]:max-w-full [&_img]:h-auto"
                dangerouslySetInnerHTML={{ __html: signatureHtml }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-line shrink-0">
          <span className="text-xs text-faint min-w-0 truncate">
            {error ? <span className="text-fg">{error}</span> : 'Sends immediately.'}
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
              disabled={sending}
              className="px-4 py-1.5 text-sm rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'Forward'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
