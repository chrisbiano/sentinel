import { toISODate, addDays } from './dates'

export const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const RECURRENCE_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Weekly on…' },
  { value: 'monthly', label: 'Monthly' },
]

// How far ahead we materialise occurrences. Each one is a real task, so this is
// a deliberate horizon rather than infinity.
const DAILY_COUNT = 90
const WEEKLY_WEEKS = 13    // ~3 months
const MONTHLY_COUNT = 12   // a year

// Weekly recurrence carries its days: "weekly:1,3,5" = Mon/Wed/Fri.
export function encodeWeekly(days) {
  return `weekly:${[...days].sort((a, b) => a - b).join(',')}`
}

export function parseRecurrence(recurrence) {
  if (!recurrence) return null
  if (recurrence.startsWith('weekly:')) {
    const days = recurrence.slice(7).split(',').filter(Boolean).map(Number)
    return { freq: 'weekly', days }
  }
  return { freq: recurrence, days: [] }
}

export function recurrenceLabel(recurrence) {
  const parsed = parseRecurrence(recurrence)
  if (!parsed) return null
  if (parsed.freq === 'daily') return 'Every day'
  if (parsed.freq === 'monthly') return 'Monthly'
  if (parsed.freq === 'weekly') {
    if (parsed.days.length === 5 && [1, 2, 3, 4, 5].every(d => parsed.days.includes(d))) {
      return 'Weekdays'
    }
    if (parsed.days.length === 7) return 'Every day'
    return parsed.days.map(d => DAY_NAMES[d]).join(', ')
  }
  return 'Repeats'
}

/**
 * The dates a repeating task should land on, starting from startISO.
 * Returns local YYYY-MM-DD strings.
 */
export function occurrences(startISO, recurrence) {
  const parsed = parseRecurrence(recurrence)
  if (!parsed) return [startISO]

  const start = new Date(`${startISO}T00:00:00`)
  const dates = []

  if (parsed.freq === 'daily') {
    for (let i = 0; i < DAILY_COUNT; i++) dates.push(addDays(start, i))
  } else if (parsed.freq === 'weekly') {
    if (parsed.days.length === 0) return [startISO]
    // Walk forward day by day, keeping the chosen weekdays.
    const limit = WEEKLY_WEEKS * 7
    for (let i = 0; i < limit; i++) {
      const d = addDays(start, i)
      if (parsed.days.includes(d.getDay())) dates.push(d)
    }
  } else if (parsed.freq === 'monthly') {
    const dayOfMonth = start.getDate()
    for (let i = 0; i < MONTHLY_COUNT; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
      // Clamp so the 31st doesn't spill into the next month (Jan 31 -> Feb 28).
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      d.setDate(Math.min(dayOfMonth, lastDay))
      dates.push(d)
    }
  } else {
    return [startISO]
  }

  return dates.map(toISODate)
}
