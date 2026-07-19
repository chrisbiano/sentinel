import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import {
  fetchTasks, insertTask, insertTasks, updateTaskRow, deleteTaskRow,
  deleteSeriesFrom, toISODate, computeRemindAt,
} from '../lib/tasks'
import { occurrences } from '../lib/recurrence'

const TASKS_KEY = 'sentinel.tasks.v1'

const defaultTasks = [
  { id: 1, title: 'Client call with RSM', time: '09:00 AM', duration: 60, hasReminder: true, isUrgent: false, completed: false, subtasks: [] },
  { id: 2, title: 'Edit video for Champions for Growth', time: '02:00 PM', duration: 120, hasReminder: false, isUrgent: false, completed: false, subtasks: [
    { id: 's1', title: 'Pull selects', done: true },
    { id: 's2', title: 'Rough cut', done: false },
    { id: 's3', title: 'Color + export', done: false },
  ] },
]

function readLocal() {
  try {
    const saved = localStorage.getItem(TASKS_KEY)
    if (saved) return JSON.parse(saved)
  } catch (e) { /* ignore corrupt storage */ }
  return null
}

export default function useTasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  // Surfaced in the UI — a failed save must never just vanish silently.
  const [error, setError] = useState(null)
  const tasksRef = useRef(tasks)
  const userIdRef = useRef(null)
  const initStarted = useRef(false) // guards against StrictMode double-run

  useEffect(() => { tasksRef.current = tasks }, [tasks])

  // ---- Local mode (no Supabase): tasks live in localStorage ----
  useEffect(() => {
    if (isSupabaseConfigured) return
    setTasks(readLocal() ?? defaultTasks)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (isSupabaseConfigured || loading) return
    try { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)) } catch (e) { /* non-fatal */ }
  }, [tasks, loading])

  // ---- DB mode: load from Supabase, migrating any localStorage tasks once ----
  useEffect(() => {
    if (!isSupabaseConfigured) return
    if (initStarted.current) return // run exactly once (survives StrictMode remount)
    initStarted.current = true
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setLoading(false); return }
        userIdRef.current = user.id

        let rows = await fetchTasks()

        if (rows.length === 0) {
          const local = readLocal()
          if (local && local.length > 0) {
            const migrated = []
            for (const t of local) {
              try { migrated.push(await insertTask(t, user.id)) }
              catch (e) { console.error('Task migration failed for one item:', e) }
            }
            rows = migrated
            localStorage.removeItem(TASKS_KEY) // migrated — don't re-import
          }
        }
        setTasks(rows)
      } catch (e) {
        console.error('Failed to load tasks:', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // ---- Handlers (optimistic local update + DB write when configured) ----
  const addTask = useCallback(async (data) => {
    const base = {
      isUrgent: false,
      completed: false,
      subtasks: [],
      date: toISODate(new Date()),
      ...data,
    }

    // A repeating task becomes one real row per occurrence, sharing a series id.
    // Each occurrence then has its own checkbox, subtasks and edits.
    const repeats = Boolean(base.recurrence) && Boolean(base.date)

    if (isSupabaseConfigured) {
      try {
        setError(null)
        if (repeats) {
          const seriesId = crypto.randomUUID()
          const rows = occurrences(base.date, base.recurrence).map(date => ({
            ...base, date, seriesId,
          }))
          const created = await insertTasks(rows, userIdRef.current)
          setTasks(prev => [...prev, ...created])
        } else {
          const created = await insertTask({ ...base, recurrence: null }, userIdRef.current)
          setTasks(prev => [...prev, created])
        }
      } catch (e) {
        console.error('Add task failed:', e)
        setError(e.message || 'Could not save that task')
      }
    } else {
      const rows = repeats
        ? occurrences(base.date, base.recurrence).map((date, i) => ({
            ...base, date, id: Date.now() + i, seriesId: 'local',
          }))
        : [{ id: Date.now(), ...base }]
      setTasks(prev => [...prev, ...rows])
    }
  }, [])

  // Make a fresh copy of a task: same title/time/duration/reminder and a clean
  // (unchecked) copy of its subtasks. Deliberately starts uncompleted and drops
  // any recurrence/series link — a duplicate is a new one-off, not a member of
  // the original's series. Pass `date` (YYYY-MM-DD) to drop the copy on another
  // day (e.g. reuse a block on the next shoot day); omit to keep the same day.
  const duplicateTask = useCallback((task, date) => {
    const newSubId = () => (crypto?.randomUUID ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`)
    const { id, seriesId, recurrence, completed, subtasks, ...rest } = task
    return addTask({
      ...rest,
      ...(date !== undefined ? { date } : {}),
      completed: false,
      subtasks: (subtasks || []).map(s => ({ id: newSubId(), title: s.title, done: false })),
    })
  }, [addTask])

  // Stop a repeating task: remove this occurrence and everything after it.
  const deleteSeries = useCallback((seriesId, fromDate) => {
    setTasks(prev => prev.filter(t => !(t.seriesId === seriesId && t.date >= fromDate)))
    if (isSupabaseConfigured) {
      deleteSeriesFrom(seriesId, fromDate).catch(e => console.error('Delete series failed:', e))
    }
  }, [])

  const updateTask = useCallback((id, data) => {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...data } : t)))
    const patch = { ...data }
    // If a reminder-relevant field changed, recompute when it fires and re-arm it.
    if ('date' in data || 'time' in data || 'hasReminder' in data) {
      const cur = tasksRef.current.find(t => t.id === id)
      patch.remindAt = computeRemindAt({ ...cur, ...data })
      patch.reminderFiredAt = null
    }
    if (isSupabaseConfigured) updateTaskRow(id, patch).catch(e => console.error('Update failed:', e))
  }, [])

  const deleteTask = useCallback((id) => {
    setTasks(prev => prev.filter(t => t.id !== id))
    if (isSupabaseConfigured) deleteTaskRow(id).catch(e => console.error('Delete failed:', e))
  }, [])

  const toggleReminder = useCallback((id) => {
    const t = tasksRef.current.find(x => x.id === id)
    if (!t) return
    const next = !t.hasReminder
    const remindAt = computeRemindAt({ ...t, hasReminder: next })
    setTasks(prev => prev.map(x => (x.id === id ? { ...x, hasReminder: next } : x)))
    if (isSupabaseConfigured) {
      updateTaskRow(id, { hasReminder: next, remindAt, reminderFiredAt: null }).catch(e => console.error(e))
    }
  }, [])

  const toggleComplete = useCallback((id) => {
    const t = tasksRef.current.find(x => x.id === id)
    if (!t) return
    const next = !t.completed
    setTasks(prev => prev.map(x => (x.id === id ? { ...x, completed: next } : x)))
    if (isSupabaseConfigured) updateTaskRow(id, { completed: next }).catch(e => console.error(e))
  }, [])

  const toggleSubtask = useCallback((taskId, subId) => {
    const t = tasksRef.current.find(x => x.id === taskId)
    if (!t) return
    const nextSubs = (t.subtasks || []).map(s => (s.id === subId ? { ...s, done: !s.done } : s))
    setTasks(prev => prev.map(x => (x.id === taskId ? { ...x, subtasks: nextSubs } : x)))
    if (isSupabaseConfigured) updateTaskRow(taskId, { subtasks: nextSubs }).catch(e => console.error(e))
  }, [])

  return {
    tasks, loading, error, clearError: () => setError(null),
    addTask, updateTask, deleteTask, deleteSeries, duplicateTask,
    toggleReminder, toggleComplete, toggleSubtask,
  }
}
