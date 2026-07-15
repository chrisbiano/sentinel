import { useState } from 'react'
import SectionHeader from './SectionHeader'
import TaskForm from './TaskForm'
import ViewSwitcher from './ViewSwitcher'

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

export default function Timeline({
  tasks,
  events,
  onToggleSubtask,
  calendarLoading,
  calendarError,
  eventNotes = {},
  onAddEventSubtask,
  onToggleEventSubtask,
  onRemoveEventSubtask,
  selectedDate,
  onChangeDate,
  defaultDate,
  onAddTask,
  onToggleComplete,
  view,
  onChangeView,
}) {
  const [addingFor, setAddingFor] = useState(null)  // event id with an open input
  const [draft, setDraft] = useState('')
  const [addingTask, setAddingTask] = useState(false)

  const submitSubtask = (eventId) => {
    onAddEventSubtask(eventId, draft)
    setDraft('')
    setAddingFor(null)
  }

  const isToday = new Date(selectedDate).toDateString() === new Date().toDateString()
  const dayLabel = new Date(selectedDate).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  })
  const shiftDay = (delta) => {
    const next = new Date(selectedDate)
    next.setDate(next.getDate() + delta)
    onChangeDate(next)
  }

  const items = [
    // General tasks (no time) have no slot on a time rail — they live in the
    // task list instead.
    ...tasks.filter(t => t.time).map(t => ({
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
      rawId: e.id,                        // key for Sentinel's event checklists
      title: e.title,
      time: e.time,
      duration: e.duration,
      kind: 'event',
      subtasks: eventNotes[e.id] || [],
    })),
  ].sort((a, b) => toMinutes(a.time) - toMinutes(b.time))

  return (
    <section>
      <SectionHeader
        icon={<TimelineIcon />}
        title={isToday ? "Today's schedule" : dayLabel}
        action={
          <div className="flex items-center gap-2">
            <ViewSwitcher value={view} onChange={onChangeView} />
            <div className="flex items-center gap-1">
            <button
              onClick={() => shiftDay(-1)}
              aria-label="Previous day"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-faint hover:text-fg hover:bg-surface2 transition-colors"
            >
              ‹
            </button>
            {!isToday && (
              <button
                onClick={() => onChangeDate(new Date())}
                className="text-xs font-medium text-muted hover:text-fg border border-line2 rounded-lg px-2 py-1 transition-colors"
              >
                Today
              </button>
            )}
            <button
              onClick={() => shiftDay(1)}
              aria-label="Next day"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-faint hover:text-fg hover:bg-surface2 transition-colors"
            >
              ›
            </button>
            </div>
          </div>
        }
      />

      {/* Calendar sync status — tells you at a glance whether events pulled in */}
      <p className="text-xs text-faint -mt-2 mb-3">
        {calendarLoading
          ? 'Syncing calendar…'
          : calendarError
            ? `Calendar error: ${calendarError}`
            : events.length > 0
              ? `${events.length} calendar event${events.length === 1 ? '' : 's'} ${isToday ? 'today' : 'this day'}`
              : `No calendar events ${isToday ? 'today' : 'on this day'}`}
      </p>

      <div className="card p-0 overflow-hidden">
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-muted">
              Nothing scheduled {isToday ? 'today' : `for ${dayLabel}`}.
            </p>
            <p className="text-xs text-faint mt-1">
              Add a task to start shaping this day.
            </p>
            <button
              onClick={() => setAddingTask(true)}
              className="mt-4 px-4 py-2 bg-accent text-accent-fg rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
            >
              + Add task
            </button>
          </div>
        ) : (
          <>
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
                  {/* Check a task off right here — no scrolling to the list.
                      Events come from Google and aren't ours to complete. */}
                  {item.kind === 'task' && (
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => onToggleComplete(item.rawId)}
                      aria-label={`Mark ${item.title} complete`}
                      className="w-3.5 h-3.5 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer shrink-0"
                    />
                  )}
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
                      <li key={s.id} className="flex items-center gap-2 group">
                        <input
                          type="checkbox"
                          checked={s.done}
                          onChange={() =>
                            item.kind === 'event'
                              ? onToggleEventSubtask(item.rawId, s.id)
                              : onToggleSubtask(item.rawId, s.id)
                          }
                          className="w-3.5 h-3.5 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                        <span className={`text-xs ${s.done ? 'line-through text-faint' : 'text-muted'}`}>
                          {s.title}
                        </span>
                        {item.kind === 'event' && (
                          <button
                            onClick={() => onRemoveEventSubtask(item.rawId, s.id)}
                            aria-label="Remove subtask"
                            className="text-faint hover:text-fg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-xs"
                          >
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Prep checklist on a calendar block — stored in Sentinel, never
                    written back to Google. */}
                {item.kind === 'event' && (
                  addingFor === item.rawId ? (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        autoFocus
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') submitSubtask(item.rawId)
                          if (e.key === 'Escape') { setDraft(''); setAddingFor(null) }
                        }}
                        placeholder="What needs doing in this block?"
                        className="input flex-1 py-1 text-xs"
                      />
                      <button
                        onClick={() => submitSubtask(item.rawId)}
                        className="text-xs px-2 py-1 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setDraft(''); setAddingFor(null) }}
                        className="text-xs text-faint hover:text-fg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setDraft(''); setAddingFor(item.rawId) }}
                      className="mt-2 text-xs text-faint hover:text-fg transition-colors"
                    >
                      + Add subtask
                    </button>
                  )
                )}
              </div>
            </li>
          ))}
        </ol>
            <button
              onClick={() => setAddingTask(true)}
              className="w-full text-left px-5 py-3 border-t border-line text-xs text-faint hover:text-fg hover:bg-surface2 transition-colors"
            >
              + Add task to this day
            </button>
          </>
        )}
      </div>

      {/* Add straight from the schedule — no jumping to another section. */}
      {addingTask && (
        <div className="mt-3">
          <TaskForm
            defaultDate={defaultDate}
            onSave={(data) => { onAddTask(data); setAddingTask(false) }}
            onCancel={() => setAddingTask(false)}
          />
        </div>
      )}
    </section>
  )
}
