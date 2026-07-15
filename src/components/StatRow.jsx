import { toMinutes } from '../lib/dates'

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}
function IconMail() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" />
    </svg>
  )
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  )
}

/**
 * Total time actually booked for the day. Overlapping blocks are merged, so a
 * double-booked hour counts once rather than inflating the total. No assumption
 * about waking hours — it's just arithmetic on what's really scheduled.
 */
function scheduledMinutes(blocks) {
  const intervals = blocks
    .map(b => [toMinutes(b.time), toMinutes(b.time) + (b.duration || 30)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])

  const merged = []
  for (const iv of intervals) {
    const last = merged[merged.length - 1]
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1])
    else merged.push([...iv])
  }
  return merged.reduce((sum, [s, e]) => sum + (e - s), 0)
}

function formatHours(mins) {
  if (mins <= 0) return '0h'
  const h = mins / 60
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`
}

export default function StatRow({ tasks, events = [], emails, isToday = true }) {
  const openTasks = tasks.filter(t => !t.completed).length
  const replyEmails = emails.filter(e => e.needsReply).length

  // Only timed things occupy the day; general tasks don't book time.
  const blocks = [...tasks.filter(t => t.time), ...events]
  const scheduled = scheduledMinutes(blocks)

  const stats = [
    { value: openTasks, label: isToday ? 'Tasks today' : 'Tasks', icon: <IconCheck />, accent: false },
    { value: replyEmails, label: 'Need reply', icon: <IconMail />, accent: true },
    { value: formatHours(scheduled), label: isToday ? 'Scheduled today' : 'Scheduled', icon: <IconClock />, accent: false },
  ]

  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4">
      {stats.map(stat => (
        <div
          key={stat.label}
          className={`card p-3 sm:p-4 ${stat.accent ? 'bg-surface2 ring-1 ring-line2' : ''}`}
        >
          <div className="text-2xl sm:text-3xl font-medium leading-none text-fg tabular-nums">
            {stat.value}
          </div>
          <div className="flex items-center gap-1.5 text-muted text-xs mt-2">
            <span className={stat.accent ? 'text-fg' : 'text-faint'}>{stat.icon}</span>
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  )
}
