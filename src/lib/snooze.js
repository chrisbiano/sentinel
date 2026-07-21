import { computeRemindAt } from './tasks'

// Shared snooze logic for both the task list and the timeline blocks.

// Snooze presets. The actual fire time is computed at click (not when the picker
// opens), in local zone → ISO, matching how reminders store remind_at.
export const SNOOZE_OPTS = [
  { key: '15m', label: '15 min', mins: 15 },
  { key: '1h', label: '1 hour', mins: 60 },
  { key: 'eve', label: 'Evening', evening: true },
]

export const fmtTime = (d) =>
  new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

// "3:15 PM" if it's later today, "Mon 8:00 AM" if the snooze crossed into another day.
export const snoozeLabel = (iso) => {
  const d = new Date(iso)
  const midnight = (x) => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y.getTime() }
  const sameDay = midnight(d) === midnight(new Date())
  return sameDay ? fmtTime(d) : `${d.toLocaleDateString([], { weekday: 'short' })} ${fmtTime(d)}`
}

export const snoozeTargetFor = (opt) => {
  const now = Date.now()
  if (opt.evening) {
    const e = new Date(); e.setHours(18, 0, 0, 0)   // 6 PM local
    // Already evening? "This evening" is behind us — nudge 2h out instead.
    return e.getTime() > now + 5 * 60000 ? e : new Date(now + 2 * 3600000)
  }
  return new Date(now + opt.mins * 60000)
}

// A reminder is "snoozed" when its stored fire time is in the future AND differs
// from the task's natural scheduled time. Parse to ms (DB and computeRemindAt
// format ISO differently) with a 60s tolerance so a normal reminder never counts.
export const isSnoozed = (task) => {
  if (!task.hasReminder || !task.remindAt) return false
  const ra = new Date(task.remindAt).getTime()
  if (!(ra > Date.now())) return false
  const natural = computeRemindAt(task)
  const nat = natural ? new Date(natural).getTime() : null
  return nat == null || Math.abs(ra - nat) > 60000
}
