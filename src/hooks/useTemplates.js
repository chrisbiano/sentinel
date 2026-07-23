import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

/* Task templates — saved blueprints of recurring work: title, duration,
   subtasks, reminder settings. Never a date or time (chosen per use).
   Used inside TaskForm: loads when a form opens; save/delete write straight to
   the table (RLS scopes everything to the user's own rows). */
export default function useTemplates() {
  const [templates, setTemplates] = useState([])
  const loaded = useRef(false)

  useEffect(() => {
    if (!isSupabaseConfigured || loaded.current) return
    loaded.current = true
    supabase
      .from('task_templates')
      .select('*')
      .order('name')
      .then(({ data }) => { if (data) setTemplates(data) })
  }, [])

  const saveTemplate = useCallback(async (tpl) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { ok: false, error: 'not signed in' }
      const row = {
        user_id: user.id,
        name: tpl.name,
        title: tpl.title,
        duration: tpl.duration ?? 30,
        has_reminder: tpl.hasReminder ?? false,
        reminder_lead_min: tpl.reminderLeadMin ?? 0,
        reminder_repeat_min: tpl.reminderRepeatMin ?? 0,
        // Titles only — done-state and ids are per-use, never part of the blueprint.
        subtasks: (tpl.subtasks || []).map(s => ({ title: s.title })),
      }
      const { data, error } = await supabase.from('task_templates').insert(row).select().single()
      if (error) return { ok: false, error: error.message }
      setTemplates(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }, [])

  const deleteTemplate = useCallback(async (id) => {
    setTemplates(prev => prev.filter(t => t.id !== id))
    await supabase.from('task_templates').delete().eq('id', id)
  }, [])

  return { templates, saveTemplate, deleteTemplate }
}
