import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

const uid = () => Math.random().toString(36).slice(2, 9)
const EMPTY = { subtasks: [], done: false, title: null, date: null, time: null }

/* Sentinel's own annotations on Google Calendar events — a prep checklist and a
   "wrapped up" flag. Calendar access is read-only, so none of this is written
   back to the user's calendar.
 *
 * Each note also stores the event's title/date/time, so an annotated block is
 * self-describing: it stays a readable, searchable record even if the account is
 * disconnected or the event is later deleted in Google. */
export default function useEventNotes() {
  const [notes, setNotes] = useState({})   // { [eventId]: { subtasks, done, title, date, time } }
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
          .select('event_id, subtasks, done, title, date, time')
        if (error) throw error

        const map = {}
        for (const row of data ?? []) {
          map[row.event_id] = {
            subtasks: row.subtasks || [],
            done: Boolean(row.done),
            title: row.title ?? null,
            date: row.date ?? null,
            time: row.time ?? null,
          }
        }
        if (!cancelled) setNotes(map)
      } catch (e) {
        console.error('Load event notes failed:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const get = (eventId) => notesRef.current[eventId] || EMPTY

  // `event` carries the block's context so the note can stand on its own later.
  const persist = useCallback(async (event, next) => {
    const record = {
      ...next,
      title: event.title ?? next.title ?? null,
      date: event.date ?? next.date ?? null,
      time: event.time ?? next.time ?? null,
    }
    setNotes(prev => ({ ...prev, [event.id]: record }))
    if (!isSupabaseConfigured || !userIdRef.current) return

    const { error } = await supabase.from('event_notes').upsert(
      {
        user_id: userIdRef.current,
        event_id: event.id,
        subtasks: record.subtasks,
        done: record.done,
        title: record.title,
        date: record.date,
        time: record.time,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,event_id' },
    )
    if (error) console.error('Save event notes failed:', error)
  }, [])

  const addSubtask = useCallback((event, title) => {
    const clean = title.trim()
    if (!clean) return
    const cur = get(event.id)
    persist(event, { ...cur, subtasks: [...cur.subtasks, { id: uid(), title: clean, done: false }] })
  }, [persist])

  const toggleSubtask = useCallback((event, subId) => {
    const cur = get(event.id)
    persist(event, {
      ...cur,
      subtasks: cur.subtasks.map(s => (s.id === subId ? { ...s, done: !s.done } : s)),
    })
  }, [persist])

  const removeSubtask = useCallback((event, subId) => {
    const cur = get(event.id)
    persist(event, { ...cur, subtasks: cur.subtasks.filter(s => s.id !== subId) })
  }, [persist])

  // "I'm wrapped up with this block" — Sentinel-side only.
  const toggleDone = useCallback((event) => {
    const cur = get(event.id)
    persist(event, { ...cur, done: !cur.done })
  }, [persist])

  /* Notes made before we stored event context have no title/date, which makes
     them unsearchable. Whenever we can see the real event, quietly fill it in. */
  const backfillContext = useCallback((events) => {
    for (const e of events) {
      const cur = notesRef.current[e.id]
      const worthKeeping = cur && (cur.subtasks?.length > 0 || cur.done)
      if (worthKeeping && (!cur.title || !cur.date)) {
        persist({ id: e.id, title: e.title, date: e.date, time: e.time }, cur)
      }
    }
  }, [persist])

  return { notes, loading, addSubtask, toggleSubtask, removeSubtask, toggleDone, backfillContext }
}
