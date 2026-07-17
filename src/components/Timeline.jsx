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

// Minutes past midnight for a time label. Handles "2:00 PM", "2:00 p.m.", and
// bare 24-hour "14:00". Anything unparseable sorts to the END of the day, never
// the top — a broken time should sink, not leap above a real noon task.
function toMinutes(t) {
  if (!t) return Number.MAX_SAFE_INTEGER
  const m = String(t).match(/(\d+):(\d+)\s*(a\.?m\.?|p\.?m\.?)?/i)
  if (!m) return Number.MAX_SAFE_INTEGER
  let h = Number(m[1])
  const min = Number(m[2])
  const ap = m[3]?.toLowerCase()
  if (ap) {                      // 12-hour with AM/PM
    h = h % 12
    if (ap.startsWith('p')) h += 12
  }
  return h * 60 + min
}

// "3:45 PM" for a minutes-past-midnight value.
function formatMin(total) {
  const h24 = Math.floor(total / 60) % 24
  const mm = String(Math.round(total % 60)).padStart(2, '0')
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${mm} ${ampm}`
}

const endLabel = (startMin, duration) => formatMin(startMin + duration)

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
  onToggleEventDone,
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

  // Event handlers take the block's context, not just its id, so the saved note
  // stays readable even if the event later disappears from Google.
  const metaOf = (item) => ({
    id: item.rawId, title: item.title, date: item.date, time: item.time,
  })

  const submitSubtask = (item) => {
    onAddEventSubtask(metaOf(item), draft)
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
      rawId: e.id,                        // key for Sentinel's event annotations
      title: e.title,
      date: e.date,
      time: e.time,
      duration: e.duration,
      kind: 'event',
      subtasks: eventNotes[e.id]?.subtasks || [],
      done: eventNotes[e.id]?.done || false,
    })),
  ].sort((a, b) => {
    // Primary order: by start time — earliest on top, standard for a timeline.
    const byStart = toMinutes(a.time) - toMinutes(b.time)
    if (byStart !== 0) return byStart
    // Same start: show the shorter one first, so a quick task at noon isn't
    // buried under a long block that also happens to start at noon.
    const byLength = (a.duration || 0) - (b.duration || 0)
    if (byLength !== 0) return byLength
    // Exact tie: a task before the calendar event it shares a slot with.
    if (a.kind !== b.kind) return a.kind === 'task' ? -1 : 1
    return 0
  })

  const spans = items.map(it => {
    const s = toMinutes(it.time)
    return { ...it, _s: s, _e: s + (it.duration || 0) }
  })

  // An every-other-hour ruler (…7, 9, 11, 1, 3, 5, 7…) down the rail. Empty
  // hours render as faint marks, so a long gap between two items reads as a
  // real gap instead of two neighbors — the list stops lying about time.
  // The range always spans at least 7 AM–7 PM, and stretches to cover an early
  // riser or a late night; snapped to odd hours so 7 AM and 7 PM are always marks.
  const startMinAll = Math.min(7 * 60, ...spans.map(s => s._s))
  const endMinAll = Math.max(19 * 60, ...spans.map(s => s._e))
  const startH = (() => { const h = Math.floor(startMinAll / 60); return h % 2 ? h : h - 1 })()
  const endH = (() => { const h = Math.ceil(endMinAll / 60); return h % 2 ? h : h + 1 })()
  const ticks = []
  for (let h = startH; h <= endH; h += 2) {
    ticks.push({ id: `tick-${h}`, isTick: true, _s: h * 60, label: formatMin(h * 60) })
  }

  // Nest everything whose start falls strictly inside a longer block — ruler
  // marks and items alike — so the indent runs unbroken through the block. A
  // mark at a block's own start stays flush (it announces the block).
  const blocks = spans.filter(b => (b.duration || 0) > 0)
  const baseRows = [...ticks, ...spans].sort((a, b) => a._s - b._s).map(r => {
    let container = null
    for (const b of blocks) {
      if (b === r) continue
      const inside = b._s < r._s && r._s < b._e && (b.duration || 0) > (r.duration || 0)
      if (inside && (!container || b.duration > container.duration)) container = b
    }
    return { ...r, inside: Boolean(container), insideTitle: container ? container.title : null, container }
  })

  // Each block that wraps a real item (or runs ≥2h) gets an end marker placed
  // at its finish, IN TIME ORDER — so a long block's end shows on the gutter
  // *after* its contents, closing the indent, instead of jumping in above them.
  const withEnd = new Set()
  baseRows.forEach(r => { if (r.container && !r.isTick) withEnd.add(r.container) })
  blocks.forEach(b => { if (b.duration >= 120) withEnd.add(b) })
  const endMarkers = [...withEnd].map(b => ({
    id: `end-${b.id}`, isEnd: true, inside: true, _s: b._e, label: formatMin(b._e), endTitle: b.title,
  }))
  const rows = [...baseRows, ...endMarkers].sort(
    (a, b) => (a._s - b._s) || ((a.isEnd ? 1 : 0) - (b.isEnd ? 1 : 0)),
  )

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
          {rows.map(item => item.isEnd ? (
            /* Where a long block closes — the bottom of its nested bracket. */
            <li key={item.id} className="relative pr-4 py-1.5 pl-6 ml-[18px] border-l border-line">
              <span className="absolute -left-[calc(4.75rem+18px)] top-0 w-16 text-right text-[10px] text-faint tabular-nums">
                {item.label}
              </span>
              <span className="absolute -left-[3px] top-1 w-1.5 h-1.5 rounded-full bg-line2" />
              <span className="text-[10px] text-faint">{item.endTitle} ends</span>
            </li>
          ) : item.isTick ? (
            <li
              key={item.id}
              className={`relative pr-4 py-2 ${
                item.inside ? 'pl-6 ml-[18px] border-l border-line' : 'pl-6'
              }`}
            >
              <span
                className={`absolute -top-1 w-16 text-right text-[10px] text-faint tabular-nums ${
                  item.inside ? '-left-[calc(4.75rem+18px)]' : '-left-[4.75rem]'
                }`}
              >
                {item.label}
              </span>
              <span className="absolute -left-[2.5px] top-0 w-1.5 h-1.5 rounded-full bg-line" />
            </li>
          ) : (
            <li
              key={item.id}
              className={`relative pr-4 py-2.5 ${
                item.inside ? 'pl-6 ml-[18px] border-l border-line' : 'pl-6'
              }`}
            >
              {/* time label, left of the rail — pushed out further for an
                  indented (inside-a-block) row so it stays in the same gutter */}
              <span
                className={`absolute top-3 w-16 text-right text-xs text-muted tabular-nums ${
                  item.inside ? '-left-[calc(4.75rem+18px)]' : '-left-[4.75rem]'
                }`}
              >
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
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Check anything off right here. For events this is Sentinel's
                      own "wrapped up" flag — Google's copy is never touched. */}
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() =>
                      item.kind === 'event'
                        ? onToggleEventDone(metaOf(item))
                        : onToggleComplete(item.rawId)
                    }
                    aria-label={`Mark ${item.title} ${item.kind === 'event' ? 'wrapped up' : 'complete'}`}
                    className="w-3.5 h-3.5 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer shrink-0"
                  />
                  <h3 className={`font-medium text-sm ${item.done ? 'line-through text-faint' : 'text-fg'}`}>
                    {item.title}
                  </h3>
                  {/* Happens inside a longer block — the "during" cue. */}
                  {item.insideTitle && (
                    <span className="text-[10px] text-muted border border-line2 rounded px-1.5 py-0.5 whitespace-nowrap">
                      during {item.insideTitle.length > 22 ? `${item.insideTitle.slice(0, 22)}…` : item.insideTitle}
                    </span>
                  )}
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
                              ? onToggleEventSubtask(metaOf(item), s.id)
                              : onToggleSubtask(item.rawId, s.id)
                          }
                          className="w-3.5 h-3.5 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                        <span className={`text-xs ${s.done ? 'line-through text-faint' : 'text-muted'}`}>
                          {s.title}
                        </span>
                        {item.kind === 'event' && (
                          <button
                            onClick={() => onRemoveEventSubtask(metaOf(item), s.id)}
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
                          if (e.key === 'Enter') submitSubtask(item)
                          if (e.key === 'Escape') { setDraft(''); setAddingFor(null) }
                        }}
                        placeholder="What needs doing in this block?"
                        className="input flex-1 py-1 text-xs"
                      />
                      <button
                        onClick={() => submitSubtask(item)}
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
