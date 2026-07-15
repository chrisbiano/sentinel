import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

/* Mail from every connected Google account, sorted by Claude into what Chris
   would actually do with it: reply / read / unsubscribe / junk.
 *
 * The Edge Function classifies a bounded batch per call so a single invocation
 * can't time out on a backlogged inbox, and tells us how many are left. So the
 * first run against six mailboxes drains in a few passes while the list fills
 * in underneath you, rather than spinning on a blank screen. */

const MAX_PASSES = 12   // a stuck backlog should stop, not bill forever

export default function useEmails() {
  const [emails, setEmails] = useState([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [remaining, setRemaining] = useState(0)
  const [error, setError] = useState(null)
  const [accountErrors, setAccountErrors] = useState([])
  const started = useRef(false)   // StrictMode double-invokes effects; classify once

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
     worse than a slow button. */
  const act = useCallback(async (messageId, action) => {
    const previous = emails
    setEmails(prev => prev.filter(e => e.message_id !== messageId))
    setError(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('gmail-action', {
        body: { messageId, action },
      })
      if (fnError) throw fnError
      if (data?.error) {
        // Sender has no one-click endpoint — the UI opens their page instead,
        // so this isn't a failure, just a different path.
        if (data.error === 'no_one_click') { setEmails(previous); return { oneClick: false } }
        throw new Error(data.error)
      }
      return { ok: true, note: data?.note }
    } catch (e) {
      console.error(`Mail action "${action}" failed:`, e)
      setEmails(previous)
      setError(e.message || `Could not ${action} that message`)
      return { ok: false }
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
  }
}
