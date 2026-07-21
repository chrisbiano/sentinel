import { supabase } from './supabase'

// DB columns are snake_case; the app uses camelCase. Map both ways.
// Local YYYY-MM-DD (not toISOString, which shifts to UTC and can land on the
// wrong day for evening/early-morning users).
export function toISODate(d) {
  const dt = d instanceof Date ? d : new Date(d)
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${dt.getFullYear()}-${m}-${day}`
}

export function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    seriesId: row.series_id ?? null,
    recurrence: row.recurrence ?? null,
    date: row.date,
    time: row.time,
    duration: row.duration,
    hasReminder: row.has_reminder,
    reminderLeadMin: row.reminder_lead_min ?? 0,
    reminderRepeatMin: row.reminder_repeat_min ?? 0,
    remindAt: row.remind_at ?? null,   // so the UI can tell a snoozed reminder from a scheduled one
    position: row.position ?? null,    // drag-reordered slot in the list (null = unset)
    isUrgent: row.is_urgent,
    completed: row.completed,
    subtasks: row.subtasks || [],
  }
}

// The absolute UTC instant a reminder should fire, from the task's LOCAL date +
// time (the browser's zone is the user's zone). Null unless it has a reminder,
// a date, and a time. The scheduler just fires anything whose remind_at passed —
// no server-side timezone math needed.
export function computeRemindAt(task) {
  if (!task.hasReminder || !task.date || !task.time) return null
  const m = String(task.time).match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return null
  let h = Number(m[1]) % 12
  if (/pm/i.test(m[3])) h += 12
  const [Y, Mo, D] = String(task.date).split('-').map(Number)
  const dt = new Date(Y, Mo - 1, D, h, Number(m[2]), 0, 0)   // local
  dt.setMinutes(dt.getMinutes() - (Number(task.reminderLeadMin) || 0))   // fire N min early
  return dt.toISOString()                                    // → UTC
}

export function taskToRow(task, userId) {
  const row = {
    // null date = unscheduled (lives in the Inbox until it gets a day).
    title: task.title,
    date: task.date ?? null,
    time: task.time ?? null,
    duration: task.duration ?? 30,
    has_reminder: task.hasReminder ?? false,
    reminder_lead_min: task.reminderLeadMin ?? 0,
    reminder_repeat_min: task.reminderRepeatMin ?? 0,
    is_urgent: task.isUrgent ?? false,
    completed: task.completed ?? false,
    subtasks: task.subtasks ?? [],
    remind_at: computeRemindAt(task),
  }
  if (task.seriesId) row.series_id = task.seriesId
  if (task.recurrence) row.recurrence = task.recurrence
  if (userId) row.user_id = userId
  return row
}

// Convert an app-shaped partial patch into DB columns for an update.
function patchToRow(patch) {
  const row = {}
  if ('title' in patch) row.title = patch.title
  if ('date' in patch) row.date = patch.date
  if ('time' in patch) row.time = patch.time
  if ('duration' in patch) row.duration = patch.duration
  if ('hasReminder' in patch) row.has_reminder = patch.hasReminder
  if ('reminderLeadMin' in patch) row.reminder_lead_min = patch.reminderLeadMin
  if ('reminderRepeatMin' in patch) row.reminder_repeat_min = patch.reminderRepeatMin
  if ('isUrgent' in patch) row.is_urgent = patch.isUrgent
  if ('completed' in patch) row.completed = patch.completed
  if ('subtasks' in patch) row.subtasks = patch.subtasks
  // remind_at / reminder_fired_at are recomputed by the hook (it has the merged
  // task) and passed through explicitly when a reminder-relevant field changes.
  if ('remindAt' in patch) row.remind_at = patch.remindAt
  if ('reminderFiredAt' in patch) row.reminder_fired_at = patch.reminderFiredAt
  if ('position' in patch) row.position = patch.position
  return row
}

export async function fetchTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data.map(rowToTask)
}

export async function insertTask(task, userId) {
  const { data, error } = await supabase
    .from('tasks')
    .insert(taskToRow(task, userId))
    .select()
    .single()
  if (error) throw error
  return rowToTask(data)
}

export async function updateTaskRow(id, patch) {
  const { error } = await supabase.from('tasks').update(patchToRow(patch)).eq('id', id)
  if (error) throw error
}

export async function deleteTaskRow(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

// Create every occurrence of a repeating task in one round trip.
export async function insertTasks(tasksArr, userId) {
  const { data, error } = await supabase
    .from('tasks')
    .insert(tasksArr.map(t => taskToRow(t, userId)))
    .select()
  if (error) throw error
  return data.map(rowToTask)
}

// Drop the rest of a series from `fromDate` on, leaving past occurrences as history.
export async function deleteSeriesFrom(seriesId, fromDate) {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('series_id', seriesId)
    .gte('date', fromDate)
  if (error) throw error
}
