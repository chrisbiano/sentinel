import { toISODate } from './tasks'

export { toISODate }

// Weeks start Sunday — matches sitting down Sunday night to plan the week ahead.
export function startOfWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

export function weekDays(date) {
  const start = startOfWeek(date)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function addMonths(date, n) {
  const d = new Date(date)
  d.setDate(1) // avoid Jan 31 + 1 month landing in March
  d.setMonth(d.getMonth() + n)
  return d
}

// Full weeks covering the month, so the grid always starts Sunday and ends Saturday.
export function monthGrid(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const start = startOfWeek(first)
  const end = addDays(startOfWeek(last), 6)
  const cells = []
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) cells.push(new Date(d))
  return cells
}

export function isSameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

// "9:00 AM" -> minutes since midnight, for sorting a day's items.
export function toMinutes(t) {
  const m = String(t).match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return 0
  let h = Number(m[1]) % 12
  if (/pm/i.test(m[3])) h += 12
  return h * 60 + Number(m[2])
}
