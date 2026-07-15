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
    date: row.date,
    time: row.time,
    duration: row.duration,
    hasReminder: row.has_reminder,
    isUrgent: row.is_urgent,
    completed: row.completed,
    subtasks: row.subtasks || [],
  }
}

export function taskToRow(task, userId) {
  const row = {
    // null date = unscheduled (lives in the Inbox until it gets a day).
    title: task.title,
    date: task.date ?? null,
    time: task.time ?? null,
    duration: task.duration ?? 30,
    has_reminder: task.hasReminder ?? false,
    is_urgent: task.isUrgent ?? false,
    completed: task.completed ?? false,
    subtasks: task.subtasks ?? [],
  }
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
  if ('isUrgent' in patch) row.is_urgent = patch.isUrgent
  if ('completed' in patch) row.completed = patch.completed
  if ('subtasks' in patch) row.subtasks = patch.subtasks
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
