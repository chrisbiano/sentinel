import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

/* Mail from every connected Google account, sorted by Claude into what Chris
   would actually do with it: reply / read / unsubscribe / junk.
 *
 * The Edge Function classifies a bounded batch per call so a single invocation
 * can't time out on a backlogged inbox, and tells us how many are left. So the
 * first run against six mailboxes drains in a few passes while the list fills
 * in underneath you, rather than spinning on a blank screen. */

// Has to cover a full listing (LIST_PER_ACCOUNT x accounts) at MAX_PER_RUN per
// pass, or a big first backlog stops halfway with no sign it gave up. Still
// bounded — a loop that can't finish should stop, not bill forever.
const MAX_PASSES = 32

export default function useEmails() {
  const [emails, setEmails] = useState([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [remaining, setRemaining] = useState(0)
  const [error, setError] = useState(null)
  const [accountErrors, setAccountErrors] = useState([])
  const [undoable, setUndoable] = useState(null)   // { email, action, label } | null
  const started = useRef(false)   // StrictMode double-invokes effects; classify once
  const undoTimer = useRef(null)

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current) }, [])

  // Offer a few seconds to take back a reversible action (mark-read / trash).
  const armUndo = useCallback((email, action) => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    const label = action === 'trash' ? 'Moved to Trash' : 'Marked read'
    setUndoable({ email, action, label })
    undoTimer.current = setTimeout(() => setUndoable(null), 6000)
  }, [])

  const runPass = useCallback(async () => {
    const { data, error: fnError } = await supabase.functions.invoke('gmail-messages')
    if (fnError) throw fnError
    if (data?.error) throw new Error(data.error)
    setEmails(data.emails ?? [])
    setRemaining(data.remaining ?? 0)
    setAccountErrors(data.accountErrors ?? [])
    return data
  }, [])

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      let passes = 0
      let data = await runPass()
      // Keep pulling until the backlog is judged. Each pass shows its progress.
      while (data.remaining > 0 && passes < MAX_PASSES) {
        passes++
        data = await runPass()
      }
    } catch (e) {
      console.error('Mail triage failed:', e)
      setError(e.message || 'Could not load mail')
    } finally {
      setLoading(false)
    }
  }, [runPass])

  useEffect(() => {
    if (started.current) return
    started.current = true
    refresh()
  }, [refresh])

  /* Act on one message. Optimistic: the row leaves the list immediately, and
     comes back if Gmail refused — a mail you think you trashed but didn't is
     worse than a slow button.
   *
   * Identified by mailbox + id, never id alone: Gmail ids are unique within a
   * mailbox, not across them. */
  const act = useCallback(async (messageId, accountEmail, action) => {
    const previous = emails
    // Capture the whole email before removing it, so undo can put it back.
    const target = emails.find(e => e.message_id === messageId && e.account_email === accountEmail)
    setEmails(prev => prev.filter(
      e => !(e.message_id === messageId && e.account_email === accountEmail)
    ))
    setError(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('gmail-action', {
        body: { messageId, accountEmail, action },
      })
      if (fnError) throw fnError
      if (data?.error) {
        // Sender has no one-click endpoint — the UI opens their page instead,
        // so this isn't a failure, just a different path.
        if (data.error === 'no_one_click') { setEmails(previous); return { oneClick: false } }
        throw new Error(data.error)
      }
      // Reversible actions get a few-second Undo. Sent/unsubscribe don't — those
      // can't be truly taken back, so no misleading offer.
      if (target && (action === 'read' || action === 'trash')) armUndo(target, action)
      return { ok: true, note: data?.note }
    } catch (e) {
      console.error(`Mail action "${action}" failed:`, e)
      setEmails(previous)
      setError(e.message || `Could not ${action} that message`)
      return { ok: false }
    }
  }, [emails, armUndo])

  // Take back the last mark-read / trash: restore it locally and reverse the
  // Gmail change (re-mark unread / untrash, and un-handle the row).
  const undo = useCallback(async () => {
    const u = undoable
    if (!u) return
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoable(null)
    setError(null)
    setEmails(list =>
      list.some(e => e.message_id === u.email.message_id && e.account_email === u.email.account_email)
        ? list
        : [...list, u.email].sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))
    )
    const reverse = u.action === 'read' ? 'unread' : 'untrash'
    const { data, error: fnError } = await supabase.functions.invoke('gmail-action', {
      body: { messageId: u.email.message_id, accountEmail: u.email.account_email, action: reverse },
    })
    if (fnError || data?.error) {
      setError((data && data.error) || fnError?.message || "Couldn't undo that")
    }
  }, [undoable])

  const dismissUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoable(null)
  }, [])

  // Drop a message from the list with no server call — for actions already
  // completed server-side (e.g. a sent reply, which gmail-send marks handled).
  const dismiss = useCallback((messageId, accountEmail) => {
    setEmails(prev => prev.filter(
      e => !(e.message_id === messageId && e.account_email === accountEmail)
    ))
  }, [])

  const same = (e, email) =>
    e.message_id === email.message_id && e.account_email === email.account_email

  /* Move an email to a different bucket by hand — Claude got it wrong. Records
     it as Chris's call so nothing re-sorts it later. Pure DB update (RLS scopes
     to his own rows); no Gmail side. */
  const reclassify = useCallback(async (email, action) => {
    const previous = emails
    setEmails(list => list.map(e =>
      same(e, email) ? { ...e, action, reason: 'You moved this here', manual_override: true } : e
    ))
    setError(null)
    const { error: dbError } = await supabase
      .from('email_verdicts')
      .update({ action, reason: 'You moved this here', manual_override: true })
      .eq('message_id', email.message_id)
      .eq('account_email', email.account_email)
    if (dbError) {
      setEmails(previous)
      setError(`Couldn't move that email: ${dbError.message}`)
    }
  }, [emails])

  /* Flag = star it in Gmail. Goes through gmail-action so the star lands on the
     real message (and mirrors into our row); flagged mail sorts to the top of
     its bucket. Optimistic, reverted if Gmail refuses. */
  const toggleFlag = useCallback(async (email) => {
    const next = !email.flagged
    const previous = emails
    setEmails(list => list.map(e => (same(e, email) ? { ...e, flagged: next } : e)))
    setError(null)
    const { data, error: fnError } = await supabase.functions.invoke('gmail-action', {
      body: {
        messageId: email.message_id,
        accountEmail: email.account_email,
        action: next ? 'star' : 'unstar',
      },
    })
    if (fnError || data?.error) {
      setEmails(previous)
      setError((data && data.error) || fnError?.message || "Couldn't flag that email")
    }
  }, [emails])

  return {
    emails,
    loading,
    remaining,
    error,
    accountErrors,
    clearError: () => setError(null),
    refresh,
    act,
    dismiss,
    reclassify,
    toggleFlag,
    undoable,
    undo,
    dismissUndo,
  }
}
