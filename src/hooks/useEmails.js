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

// supabase-js collapses any non-2xx into a generic "Edge Function returned a
// non-2xx status code" and hides the body. Read the function's own JSON payload
// so we can show what actually happened (e.g. "that account is no longer
// connected") instead of the opaque code.
async function fnErrorBody(fnError) {
  try { return await fnError?.context?.json?.() } catch { return null }
}

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
      if (fnError) {
        // "No one-click unsubscribe" comes back as a non-2xx, which supabase-js
        // surfaces as an error and hides the body — read it to recover the soft
        // signal so we open the sender's page instead of showing an error.
        const body = await fnErrorBody(fnError)
        if (body?.error === 'no_one_click') { setEmails(previous); return { oneClick: false } }
        // Otherwise prefer the function's human message (e.g. account not
        // connected) over the opaque "non-2xx status code".
        setEmails(previous)
        setError(body?.message || body?.error || fnError.message || `Could not ${action} that message`)
        return { ok: false }
      }
      if (data?.error) {
        // Same case, if the function ever returns it as a 200.
        if (data.error === 'no_one_click') { setEmails(previous); return { oneClick: false } }
        setEmails(previous)
        setError(data.message || data.error)
        return { ok: false }
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
      const body = fnError ? await fnErrorBody(fnError) : null
      setError(body?.message || body?.error || (data && (data.message || data.error)) || fnError?.message || "Couldn't undo that")
    }
  }, [undoable])

  const dismissUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoable(null)
  }, [])

  /* Remember that a "reply later" task was made for this email, so its + Task
     button stays greyed and can't spawn a duplicate — persists across reloads. */
  const markTaskAdded = useCallback(async (email) => {
    const previous = emails
    setEmails(list => list.map(e => (same(e, email) ? { ...e, task_created: true } : e)))
    const { error: dbError } = await supabase
      .from('email_verdicts')
      .update({ task_created: true })
      .eq('message_id', email.message_id)
      .eq('account_email', email.account_email)
    if (dbError) {
      setEmails(previous)
      setError(`Couldn't mark that email: ${dbError.message}`)
    }
  }, [emails])

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
      const body = fnError ? await fnErrorBody(fnError) : null
      setEmails(previous)
      setError(body?.message || body?.error || (data && (data.message || data.error)) || fnError?.message || "Couldn't flag that email")
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
    markTaskAdded,
    undoable,
    undo,
    dismissUndo,
  }
}
