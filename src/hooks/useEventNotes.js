import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

const uid = () => Math.random().toString(36).slice(2, 9)

/* Sentinel-side checklists attached to Google Calendar events. Calendar access
   is read-only, so these live here and never touch the user's real calendar. */
export default function useEventNotes() {
  const [notes, setNotes] = useState({})   // { [eventId]: subtask[] }
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const notesRef = useRef(notes)
  const userIdRef = useRef(null)

  useEffect(() => { notesRef.current = notes }, [notes])

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { if (!cancelled) setLoading(false); return }
        userIdRef.current = user.id

        const { data, error } = await supabase
          .from('event_notes')
          .select('event_id, subtasks')
        if (error) throw error

        const map = {}
        for (const row of data ?? []) map[row.event_id] = row.subtasks || []
        if (!cancelled) setNotes(map)
      } catch (e) {
        console.error('Load event notes failed:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Optimistic local update + upsert the whole list for that event.
  const persist = useCallback(async (eventId, subtasks) => {
    setNotes(prev => ({ ...prev, [eventId]: subtasks }))
    if (!isSupabaseConfigured || !userIdRef.current) return
    const { error } = await supabase.from('event_notes').upsert(
      {
        user_id: userIdRef.current,
        event_id: eventId,
        subtasks,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,event_id' },
    )
    if (error) console.error('Save event notes failed:', error)
  }, [])

  const addSubtask = useCallback((eventId, title) => {
    const clean = title.trim()
    if (!clean) return
    const current = notesRef.current[eventId] || []
    persist(eventId, [...current, { id: uid(), title: clean, done: false }])
  }, [persist])

  const toggleSubtask = useCallback((eventId, subId) => {
    const current = notesRef.current[eventId] || []
    persist(eventId, current.map(s => (s.id === subId ? { ...s, done: !s.done } : s)))
  }, [persist])

  const removeSubtask = useCallback((eventId, subId) => {
    const current = notesRef.current[eventId] || []
    persist(eventId, current.filter(s => s.id !== subId))
  }, [persist])

  return { notes, loading, addSubtask, toggleSubtask, removeSubtask }
}
