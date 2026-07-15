import { useState, useEffect, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

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

// Today, in the user's local timezone.
function dayBounds() {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end = new Date(); end.setHours(23, 59, 59, 999)
  return { timeMin: start.toISOString(), timeMax: end.toISOString() }
}

export default function useCalendarEvents() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('calendar-events', {
        body: dayBounds(),
      })
      if (fnError) throw fnError
      const normalized = (data?.events ?? [])
        .filter(e => e.start && !e.allDay) // all-day events have no slot on a time-blocked day
        .map(e => ({
          id: e.id,
          title: e.title,
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
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { events, loading, error, refresh }
}
