import SectionHeader from './SectionHeader'

function TimelineIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M4 6h16M4 12h10M4 18h7" />
    </svg>
  )
}

function BellDot() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

function toMinutes(t) {
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return 0
  let h = Number(m[1]) % 12
  if (/pm/i.test(m[3])) h += 12
  return h * 60 + Number(m[2])
}

function endLabel(startMin, duration) {
  const total = startMin + duration
  const h24 = Math.floor(total / 60) % 24
  const mm = String(total % 60).padStart(2, '0')
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${mm} ${ampm}`
}

export default function Timeline({ tasks, events, onToggleSubtask }) {
  const items = [
    ...tasks.map(t => ({
      id: `t-${t.id}`,
      rawId: t.id,
      title: t.title,
      time: t.time,
      duration: t.duration,
      kind: 'task',
      hasReminder: t.hasReminder,
      done: t.completed,
      subtasks: t.subtasks || [],
    })),
    ...events.map(e => ({
      id: `e-${e.id}`,
      title: e.title,
      time: e.time,
      duration: e.duration,
      kind: 'event',
      subtasks: [],
    })),
  ].sort((a, b) => toMinutes(a.time) - toMinutes(b.time))

  return (
    <section>
      <SectionHeader icon={<TimelineIcon />} title="Today's schedule" count={items.length} />

      <div className="card p-0 overflow-hidden">
        <ol className="relative border-l border-line ml-[4.75rem] py-2">
          {items.map(item => (
            <li key={item.id} className="relative pl-6 pr-4 py-2.5">
              {/* time label, left of the rail */}
              <span className="absolute -left-[4.75rem] top-3 w-16 text-right text-xs text-muted tabular-nums">
                {item.time}
              </span>
              {/* node on the rail */}
              <span
                className={`absolute -left-[5px] top-3.5 w-2.5 h-2.5 rounded-full ring-4 ring-surface ${
                  item.kind === 'event' ? 'bg-fg' : 'bg-surface2 border border-line2'
                }`}
              />
              {/* block */}
              <div className={item.done ? 'opacity-50' : ''}>
                <div className="flex items-center gap-2">
                  <h3 className={`font-medium text-sm ${item.done ? 'line-through text-faint' : 'text-fg'}`}>
                    {item.title}
                  </h3>
                  {item.kind === 'task' && item.hasReminder && (
                    <span className="text-faint" title="Reminder on"><BellDot /></span>
                  )}
                  {item.subtasks.length > 0 && (
                    <span className="text-xs text-faint tabular-nums">
                      {item.subtasks.filter(s => s.done).length}/{item.subtasks.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-faint">
                  <span className="tabular-nums">{item.time} – {endLabel(toMinutes(item.time), item.duration)}</span>
                  <span>·</span>
                  <span>{item.duration} min</span>
                  <span className="ml-1 px-1.5 py-0.5 rounded border border-line text-muted capitalize">
                    {item.kind}
                  </span>
                </div>

                {item.subtasks.length > 0 && (
                  <ul className="mt-2.5 space-y-1.5">
                    {item.subtasks.map(s => (
                      <li key={s.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={s.done}
                          onChange={() => onToggleSubtask(item.rawId, s.id)}
                          className="w-3.5 h-3.5 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                        <span className={`text-xs ${s.done ? 'line-through text-faint' : 'text-muted'}`}>
                          {s.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
