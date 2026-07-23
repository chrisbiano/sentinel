import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { toISODate } from '../lib/tasks'

// The function returns ISO timestamps; the browser knows the user's timezone,
// so we format to local time here rather than guessing on the server.
function toTimeLabel(iso) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function minutesBetween(startIso, endIso) {
  const mins = Math.round((new Date(endIso) - new Date(startIso)) / 60000)
  return mins > 0 ? mins : 30
}

// Range → already-fetched events, kept for the whole session. Revisiting a day
// (e.g. paging back to yesterday) shows instantly from here instead of waiting
// ~5s on the Google round-trip every time. Module-level so it survives
// remounts. Google calendar reads are read-only, so stale-then-refresh is safe.
const cache = new Map()

/**
 * Events across every connected calendar for an inclusive date range, in the
 * user's local timezone. Day view passes the same date twice; week view passes
 * the week's bounds.
 *
 * Stale-while-revalidate: a cached range paints immediately (no spinner) and is
 * quietly re-fetched in the background so it stays current; an uncached range
 * shows the loading state as before.
 */
export default function useCalendarEvents(rangeStart, rangeEnd) {
  const startKey = toISODate(rangeStart)
  const endKey = toISODate(rangeEnd ?? rangeStart)
  const cacheKey = `${startKey}|${endKey}`

  const [events, setEvents] = useState(() => cache.get(cacheKey) ?? [])
  const [loading, setLoading] = useState(isSupabaseConfigured && !cache.has(cacheKey))
  const [error, setError] = useState(null)
  // Ignore a slow response if the range changed before it landed.
  const activeKey = useRef(cacheKey)
  activeKey.current = cacheKey

  const fetchRange = useCallback(async ({ silent } = {}) => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    const key = `${startKey}|${endKey}`
    if (!silent) setLoading(true)
    setError(null)
    try {
      const start = new Date(`${startKey}T00:00:00`)
      const end = new Date(`${endKey}T23:59:59`)
      const { data, error: fnError } = await supabase.functions.invoke('calendar-events', {
        body: { timeMin: start.toISOString(), timeMax: end.toISOString() },
      })
      if (fnError) throw fnError
      const normalized = (data?.events ?? [])
        .filter(e => e.start && !e.allDay) // all-day events have no slot on a time-blocked day
        .map(e => ({
          id: e.id,
          title: e.title,
          date: toISODate(new Date(e.start)),
          time: toTimeLabel(e.start),
          duration: e.end ? minutesBetween(e.start, e.end) : 30,
          account: e.account,
        }))
      cache.set(key, normalized)
      // Only apply if the user is still on this range.
      if (activeKey.current === key) setEvents(normalized)
    } catch (e) {
      console.error('Calendar fetch failed:', e)
      if (activeKey.current === key && !silent) setError(e.message || 'Could not load calendar')
    } finally {
      if (activeKey.current === key) setLoading(false)
    }
  }, [startKey, endKey])

  useEffect(() => {
    if (cache.has(cacheKey)) {
      // Paint the cached day instantly, then refresh quietly for freshness.
      setEvents(cache.get(cacheKey))
      setLoading(false)
      fetchRange({ silent: true })
    } else {
      fetchRange()
    }
  }, [cacheKey, fetchRange])

  // The header's manual refresh: drop the WHOLE session cache (an event just
  // edited in Google Calendar should be fresh on every day you visit next, not
  // only the one on screen) and refetch the visible range with the loading state
  // showing, so the tap visibly did something.
  const refresh = useCallback(() => {
    cache.clear()
    return fetchRange()
  }, [fetchRange])

  return { events, loading, error, refresh }
}
