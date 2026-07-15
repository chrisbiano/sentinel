import { useState, useEffect, useCallback } from 'react'
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

/**
 * Events across every connected calendar for an inclusive date range, in the
 * user's local timezone. Day view passes the same date twice; week view passes
 * the week's bounds.
 */
export default function useCalendarEvents(rangeStart, rangeEnd) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState(null)

  // Primitive keys so the effect re-runs when the range changes, not every render.
  const startKey = toISODate(rangeStart)
  const endKey = toISODate(rangeEnd ?? rangeStart)

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true)
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
      setEvents(normalized)
    } catch (e) {
      console.error('Calendar fetch failed:', e)
      setError(e.message || 'Could not load calendar')
    } finally {
      setLoading(false)
    }
  }, [startKey, endKey])

  useEffect(() => { refresh() }, [refresh])

  return { events, loading, error, refresh }
}
