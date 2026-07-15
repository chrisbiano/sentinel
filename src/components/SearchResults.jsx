import { recurrenceLabel } from '../lib/recurrence'

function dayLabel(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

/* Results for a search across everything on record — your tasks, plus the
   calendar blocks you annotated. Answers "when did I work on this?" */
export default function SearchResults({ tasks, eventNotes = {}, query, onChangeDate }) {
  const q = query.trim().toLowerCase()

  // Annotated blocks carry their own title/date, so they're searchable without Google.
  const annotatedBlocks = Object.entries(eventNotes)
    .filter(([, n]) => n.date && n.title && (n.subtasks?.length > 0 || n.done))
    .map(([id, n]) => ({
      id: `note-${id}`,
      title: n.title,
      date: n.date,
      time: n.time,
      subtasks: n.subtasks || [],
      isBlock: true,
    }))

  // Match the title OR any subtask — you might remember the step, not the block.
  const hit = (item) =>
    item.title.toLowerCase().includes(q) ||
    (item.subtasks || []).some(s => String(s.title).toLowerCase().includes(q))

  const matches = [...tasks.filter(t => t.date), ...annotatedBlocks]
    .filter(hit)
    .sort((a, b) => b.date.localeCompare(a.date))   // newest first

  const byDay = []
  for (const t of matches) {
    const last = byDay[byDay.length - 1]
    if (last && last.date === t.date) last.items.push(t)
    else byDay.push({ date: t.date, items: [t] })
  }

  const openDay = (iso) => onChangeDate(new Date(`${iso}T00:00:00`))

  return (
    <section>
      <p className="text-xs text-faint mb-3">
        {matches.length === 0
          ? `Nothing matching “${query}”.`
          : `${matches.length} result${matches.length === 1 ? '' : 's'} across ${byDay.length} day${byDay.length === 1 ? '' : 's'} — newest first.`}
      </p>

      {byDay.length === 0 ? (
        <div className="card">
          <p className="text-muted text-sm">
            Try a client or project name — search covers your tasks, your calendar
            blocks, and the subtasks inside them.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {byDay.map(group => (
            <div key={group.date} className="card">
              <button
                onClick={() => openDay(group.date)}
                className="text-xs font-medium text-muted hover:text-fg transition-colors mb-2"
              >
                {dayLabel(group.date)} →
              </button>
              <div className="space-y-2">
                {group.items.map(t => (
                  <div key={t.id}>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`text-sm ${t.completed ? 'text-muted' : 'text-fg'}`}>
                        {t.title}
                      </span>
                      {t.time && <span className="text-xs text-faint tabular-nums">{t.time}</span>}
                      {t.isBlock && (
                        <span className="text-xs text-faint border border-line px-1.5 rounded">block</span>
                      )}
                      {t.recurrence && (
                        <span className="text-xs text-faint">↻ {recurrenceLabel(t.recurrence)}</span>
                      )}
                    </div>
                    {t.subtasks?.length > 0 && (
                      <ul className="mt-1 ml-3 space-y-0.5">
                        {t.subtasks.map(s => (
                          <li
                            key={s.id}
                            className={`text-xs ${s.done ? 'line-through text-faint' : 'text-muted'}`}
                          >
                            · {s.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
