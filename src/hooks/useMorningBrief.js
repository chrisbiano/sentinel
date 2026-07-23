import { useState, useEffect, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { toISODate } from '../lib/tasks'

/* The daily brief as a dashboard card (not a fleeting push). First generated at
   or after the user's chosen send time by the `morning-brief` function and cached
   locally — it lives at the top of the dashboard until dismissed. It's a LIVING
   brief: because it reflects the current time of day, a same-day brief older than
   STALE_MS is regenerated when the app is reopened/refocused, so it keeps up with
   the day instead of freezing at dawn. Fully regenerates on a new day. */
const KEY = 'sentinel.brief.v1'
const STALE_MS = 2 * 60 * 60 * 1000   // a same-day brief older than 2h is refreshed on reopen

const readCache = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}
const writeCache = (rec) => {
  try { localStorage.setItem(KEY, JSON.stringify(rec)) } catch { /* non-fatal */ }
}

// Is the local clock at or past "HH:MM"?
const pastTime = (hhmm) => {
  const [h, m] = String(hhmm || '07:00').split(':').map(Number)
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes() >= (h || 0) * 60 + (m || 0)
}

export default function useMorningBrief({ enabled, briefTime }) {
  const [text, setText] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)   // bumped by refresh() to force a regenerate
  const genStarted = useRef(false)

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured) { setText(null); setDismissed(false); return }
    const today = toISODate(new Date())
    const cache = readCache()

    // Same-day cache — reuse text and dismissed state. Keep it only if it's still
    // fresh; a stale one (>STALE_MS old) falls through and regenerates so the
    // brief reflects the current time of day. Old text stays on screen while the
    // new one loads (no blank flash).
    if (cache?.date === today) {
      setText(cache.text || null)
      setDismissed(Boolean(cache.dismissed))
      if (cache.dismissed) return
      const fresh = cache.text && cache.generatedAt && (Date.now() - cache.generatedAt <= STALE_MS)
      if (fresh) return
    } else {
      setText(null); setDismissed(false)
    }

    // Only generate once it's the user's brief time (or later) today.
    if (!pastTime(briefTime) || genStarted.current) return
    genStarted.current = true
    setLoading(true)
    ;(async () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const { data, error } = await supabase.functions.invoke('morning-brief', { body: { tz, today } })
        if (error || data?.error) throw new Error(data?.error || error?.message || 'brief failed')
        writeCache({ date: today, text: data.brief, dismissed: false, generatedAt: Date.now() })
        setText(data.brief)
        setDismissed(false)
      } catch (e) {
        console.error('daily brief failed:', e)
        genStarted.current = false   // let a later load retry
      } finally {
        setLoading(false)
      }
    })()
  }, [enabled, briefTime, tick])

  // Keep the brief current across the day: when the app comes back to the
  // foreground (a warm-resumed PWA may never remount), regenerate if it's a new
  // day or the same-day brief has gone stale — unless the user dismissed it.
  useEffect(() => {
    if (!enabled) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const today = toISODate(new Date())
      const cache = readCache()
      if (cache?.date === today && cache.dismissed) return
      const stale = cache?.date !== today || !cache?.generatedAt || (Date.now() - cache.generatedAt > STALE_MS)
      if (stale) { genStarted.current = false; setTick(t => t + 1) }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled])

  // Throw away today's cached brief and generate a fresh one (e.g. plans changed,
  // or tasks were knocked out since the morning).
  const refresh = () => {
    try { localStorage.removeItem(KEY) } catch { /* non-fatal */ }
    genStarted.current = false
    setText(null)
    setTick(t => t + 1)
  }

  const dismiss = () => {
    const today = toISODate(new Date())
    const cache = readCache() || {}
    writeCache({ ...cache, date: today, text: text ?? cache.text ?? '', dismissed: true })
    setDismissed(true)
  }

  const show = Boolean(enabled) && !dismissed && (loading || Boolean(text))
  return { brief: text, loading, show, dismiss, refresh }
}
