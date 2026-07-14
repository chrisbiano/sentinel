import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { fetchTasks, insertTask, updateTaskRow, deleteTaskRow } from '../lib/tasks'

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
    const base = { isUrgent: false, completed: false, subtasks: [], ...data }
    if (isSupabaseConfigured) {
      try {
        const created = await insertTask(base, userIdRef.current)
        setTasks(prev => [...prev, created])
      } catch (e) { console.error('Add task failed:', e) }
    } else {
      setTasks(prev => [...prev, { id: Date.now(), ...base }])
    }
  }, [])

  const updateTask = useCallback((id, data) => {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...data } : t)))
    if (isSupabaseConfigured) updateTaskRow(id, data).catch(e => console.error('Update failed:', e))
  }, [])

  const deleteTask = useCallback((id) => {
    setTasks(prev => prev.filter(t => t.id !== id))
    if (isSupabaseConfigured) deleteTaskRow(id).catch(e => console.error('Delete failed:', e))
  }, [])

  const toggleReminder = useCallback((id) => {
    const t = tasksRef.current.find(x => x.id === id)
    if (!t) return
    const next = !t.hasReminder
    setTasks(prev => prev.map(x => (x.id === id ? { ...x, hasReminder: next } : x)))
    if (isSupabaseConfigured) updateTaskRow(id, { hasReminder: next }).catch(e => console.error(e))
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

  return { tasks, loading, addTask, updateTask, deleteTask, toggleReminder, toggleComplete, toggleSubtask }
}
