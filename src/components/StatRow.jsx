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
function IconFocus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" />
    </svg>
  )
}

export default function StatRow({ tasks, emails }) {
  const upcomingTasks = tasks.filter(t => !t.completed).length
  const replyEmails = emails.filter(e => e.needsReply).length

  const stats = [
    { value: upcomingTasks, label: 'Tasks today', icon: <IconCheck />, accent: false },
    { value: replyEmails, label: 'Need reply', icon: <IconMail />, accent: true },
    { value: 2, label: 'Focus blocks', icon: <IconFocus />, accent: false },
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
