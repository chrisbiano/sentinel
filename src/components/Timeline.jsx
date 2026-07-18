import { useState, useRef, useLayoutEffect } from 'react'
import SectionHeader from './SectionHeader'
import TaskForm from './TaskForm'
import ViewSwitcher from './ViewSwitcher'
import SortableSubtasks from './SortableSubtasks'

// Whole-hour marks to show down a block, positioned between the *measured* pixel
// positions of the start (sY) and end (eY) gutter labels — NOT by percent of the
// box height. The start/end labels are pinned to their content rows (the title
// and the "ends" line), which aren't at the box's true 0%/100%, so anchoring the
// interior marks to those same two points is what makes the spacing read right
// (a 2-hour gap looks twice a 1-hour gap). Marks stay on real clock hours, keep
// clear of the start/end labels, and thin to fit. Short blocks show few or none.
const MARK_CLEAR = 22   // px kept clear of the start and end labels
const MARK_GAP = 22     // min px between adjacent marks
function hourMarksBetween(b, sY, eY) {
  const span = eY - sY
  if (span <= 0) return []
  const endMin = b._s + b.duration
  const inBand = []
  for (let m = (Math.floor(b._s / 60) + 1) * 60; m < endMin; m += 60) {
    const y = sY + ((m - b._s) / b.duration) * span
    if (y - sY >= MARK_CLEAR && eY - y >= MARK_CLEAR) inBand.push({ m, y })
  }
  if (inBand.length === 0) return []
  const maxFit = Math.max(1, Math.floor((span - 2 * MARK_CLEAR) / MARK_GAP) + 1)
  const step = inBand.length > maxFit ? Math.ceil(inBand.length / maxFit) : 1
  return inBand
    .filter((_, i) => i % step === 0)
    .map(o => ({ y: o.y, label: formatMinShort(o.m) }))
}

// Interior hour marks for a block. Measures the block's own <li> and the pixel
// positions of its start/end gutter labels (tagged data-gutter), so the marks
// line up proportionally with them rather than against an estimate or raw height.
function HourMarks({ block, gutClass }) {
  const anchor = useRef(null)
  const [span, setSpan] = useState(null)   // { sY, eY } label-center offsets in the li
  useLayoutEffect(() => {
    const li = anchor.current?.offsetParent
    if (!li) return
    const measure = () => {
      const s = li.querySelector('[data-gutter="start"]')
      const e = li.querySelector('[data-gutter="end"]')
      if (!s || !e) { setSpan(null); return }
      const liTop = li.getBoundingClientRect().top
      const cy = (el) => el.getBoundingClientRect().top + el.offsetHeight / 2 - liTop
      setSpan({ sY: cy(s), eY: cy(e) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(li)
    return () => ro.disconnect()
  }, [])
  const marks = span ? hourMarksBetween(block, span.sY, span.eY) : []
  return (
    <>
      <span ref={anchor} className="absolute left-0 top-0 w-0 h-0" aria-hidden="true" />
      {marks.map((m, i) => (
        <span
          key={i}
          style={{ top: `${m.y}px` }}
          className={`absolute ${gutClass} -translate-y-1/2 w-16 text-right text-[10px] text-faint tabular-nums`}
        >
          {m.label}
        </span>
      ))}
    </>
  )
}

// A title you can rename by double-clicking (tasks only — event titles come
// from Google and would be overwritten on the next sync).
function EditableTitle({ title, done, editable, overlaps, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const save = () => {
    const t = draft.trim()
    if (t && t !== title) onSave(t)
    setEditing(false)
  }
  if (editing) {
    return (
      <textarea
        autoFocus
        rows={3}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() }
          if (e.key === 'Escape') setEditing(false)
        }}
        className="input py-1 text-sm font-medium flex-1 min-w-0 w-0 resize-none leading-snug"
      />
    )
  }
  const color = done ? 'line-through text-faint' : overlaps ? 'text-amber-400' : 'text-fg'
  return (
    <h3
      onClick={() => { if (editable) { setDraft(title); setEditing(true) } }}
      title={editable ? 'Tap to edit' : undefined}
      className={`font-medium text-sm ${color} ${editable && !done ? 'cursor-text' : ''}`}
    >
      {title}
    </h3>
  )
}

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

// Meridiem-less time ("10:30") for the tight interior gutter of an event box,
// where the AM/PM is already established by the block's start and end labels.
function formatMinShort(total) {
  const h24 = Math.floor(total / 60) % 24
  const mm = String(Math.round(total % 60)).padStart(2, '0')
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${mm}`
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
  onSetEventSubtasks,
  onToggleEventDone,
  selectedDate,
  onChangeDate,
  defaultDate,
  onAddTask,
  onUpdateTask,
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
    const byStart = toMinutes(a.time) - toMinutes(b.time)
    if (byStart !== 0) return byStart
    const byLength = (a.duration || 0) - (b.duration || 0)
    if (byLength !== 0) return byLength
    if (a.kind !== b.kind) return a.kind === 'task' ? -1 : 1
    return 0
  })

  const spans = items.map(it => {
    const s = toMinutes(it.time)
    return { ...it, _s: s, _e: s + (it.duration || 0) }
  })

  // Every-other-hour ruler (…7, 9, 11, 1, 3, 5, 7…). Empty hours become faint
  // marks so a long gap reads as a real gap. Always spans at least 7 AM–7 PM,
  // snapped to odd hours, and stretches for an early riser or a late night.
  const startMinAll = Math.min(7 * 60, ...spans.map(s => s._s))
  const endMinAll = Math.max(19 * 60, ...spans.map(s => s._e))
  const startH = (() => { const h = Math.floor(startMinAll / 60); return h % 2 ? h : h - 1 })()
  const endH = (() => { const h = Math.ceil(endMinAll / 60); return h % 2 ? h : h + 1 })()
  const ticks = []
  for (let h = startH; h <= endH; h += 2) {
    ticks.push({ id: `tick-${h}`, isTick: true, _s: h * 60, label: formatMin(h * 60) })
  }

  // A block owns its window; work inside it should be that block's subtasks. So
  // any *separate* item that lays claim to the same time is a double-booking —
  // whether it's tucked entirely inside a block or spilling past its edge. Flag
  // the intruder, not the block: X is flagged if it intersects some Y that X
  // does not itself contain (a longer block it sits inside, or a peer it fights
  // with). The block that contains everything stays clean — it's not the problem.
  const contains = (a, b) => a !== b && a._s <= b._s && b._e <= a._e && a.duration > b.duration
  const intersects = (a, b) => a._s < b._e && b._s < a._e
  const conflicts = new Set()
  for (const a of spans) {
    for (const b of spans) {
      if (a !== b && intersects(a, b) && !contains(a, b)) { conflicts.add(a); break }
    }
  }

  // A block gets an outline box if it runs long (≥2h) or wraps a real item.
  // A boxed block nested inside a bigger box doesn't get its own (one level).
  const blocks = spans.filter(b => (b.duration || 0) > 0)
  const boxable = blocks.filter(b => b.duration >= 120 || spans.some(x => contains(b, x)))
  const boxBlocks = boxable.filter(b => !boxable.some(o => contains(o, b)))

  // A row belongs to a box if it starts strictly inside the box (an item must
  // also END inside — a thing that runs past the block is a conflict, not a
  // tenant, and stays outside).
  const ownerOf = (r) => boxBlocks.find(b =>
    r.isTick
      ? (b._s < r._s && r._s < b._e)
      : (b._s < r._s && r._e <= b._e && b.duration > r.duration),
  )

  // Times the schedule already prints next to something (a block's start/end, or
  // a loose item's start). A rail hour tick at the same minute would just double
  // the label — e.g. an event ending 5:00 PM next to the 5 PM ruler tick — so
  // those ticks are dropped.
  const labeledTimes = new Set()
  boxBlocks.forEach(b => { labeledTimes.add(b._s); labeledTimes.add(b._e) })
  spans.filter(s => !boxBlocks.includes(s) && !ownerOf(s)).forEach(s => labeledTimes.add(s._s))

  const groups = new Map(boxBlocks.map(b => [b, []]))
  const top = []
  for (const r of [...ticks, ...spans]) {
    if (!r.isTick && boxBlocks.includes(r)) continue   // a box's own header, added below
    const owner = ownerOf(r)
    // Hour ticks inside a block are handled by the block itself (its start, end,
    // and evenly-spread interior marks). On the open rail, keep a tick only if no
    // real item already labels that minute.
    if (r.isTick) {
      if (!owner && !labeledTimes.has(r._s)) top.push(r)
      continue
    }
    const row = { ...r, overlaps: conflicts.has(r), insideBox: Boolean(owner) }
    if (owner) groups.get(owner).push(row)
    else top.push(row)
  }
  boxBlocks.forEach(b => {
    groups.get(b).push({ id: `end-${b.id}`, isEnd: true, _s: b._e, label: formatMin(b._e), endTitle: b.title })
  })
  boxBlocks.forEach(b => top.push({
    isBox: true, id: `box-${b.id}`, _s: b._s, block: { ...b, overlaps: conflicts.has(b) }, kids: groups.get(b),
  }))

  // A "you are here" marker, only on today and only within the day's frame, slots
  // into the flow by time. If the current moment is inside an event, it drops into
  // that block so the line reads as "you're in the middle of this."
  if (isToday) {
    const d = new Date()
    const nowMin = d.getHours() * 60 + d.getMinutes()
    if (nowMin >= startMinAll && nowMin <= endMinAll) {
      const nowNode = { id: 'now', isNow: true, _s: nowMin, label: formatMin(nowMin) }
      const host = boxBlocks.find(b => b._s <= nowMin && nowMin <= b._e)
      if (host) groups.get(host).push(nowNode)
      else top.push(nowNode)
    }
  }

  const bySort = (a, b) => (a._s - b._s) || ((a.isEnd ? 1 : 0) - (b.isEnd ? 1 : 0)) || ((a.isBox ? 1 : 0) - (b.isBox ? 1 : 0))
  top.sort(bySort)
  groups.forEach(kids => kids.sort(bySort))

  /* ---------- shared row rendering ---------- */

  // The inner content of an item — identical whether it sits loose on the rail
  // or inside a block's outline. This is what used to live inline in the <li>.
  const itemBody = (item) => (
    <div className={item.done ? 'opacity-50' : ''}>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Check anything off right here. For events this is Sentinel's own
            "wrapped up" flag — Google's copy is never touched. */}
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
        <EditableTitle
          title={item.title}
          done={item.done}
          overlaps={item.overlaps}
          editable={item.kind === 'task'}
          onSave={(t) => onUpdateTask(item.rawId, { title: t })}
        />
        {/* A separate item claiming time another item already owns — a
            heads-up to fold it into that block or move it. */}
        {item.overlaps && (
          <span className="text-[10px] text-amber-400 border border-amber-500/40 bg-amber-500/10 rounded px-1.5 py-0.5 whitespace-nowrap">
            overlap
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

      {/* Drag the grip to reorder, double-click text to rename. Events also
          remove; task subtasks are added/removed from the task's edit form. */}
      {item.subtasks.length > 0 && (
        <SortableSubtasks
          subtasks={item.subtasks}
          onToggle={(id) =>
            item.kind === 'event'
              ? onToggleEventSubtask(metaOf(item), id)
              : onToggleSubtask(item.rawId, id)
          }
          onRemove={item.kind === 'event' ? (id) => onRemoveEventSubtask(metaOf(item), id) : null}
          onEdit={(id, title) => {
            const next = item.subtasks.map(s => (s.id === id ? { ...s, title } : s))
            item.kind === 'event'
              ? onSetEventSubtasks(metaOf(item), next)
              : onUpdateTask(item.rawId, { subtasks: next })
          }}
          onReorder={(next) =>
            item.kind === 'event'
              ? onSetEventSubtasks(metaOf(item), next)
              : onUpdateTask(item.rawId, { subtasks: next })
          }
        />
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
  )

  // A loose item on the rail (with its rail dot).
  const itemRow = (item) => (
    <li key={item.id} className="relative pr-4 py-2.5 pl-6">
      <span className="absolute -left-[4.75rem] top-3 w-16 text-right text-xs text-muted tabular-nums">
        {item.time}
      </span>
      <span
        className={`absolute -left-[5px] top-3.5 w-2.5 h-2.5 rounded-full ring-4 ring-surface ${
          item.kind === 'event' ? 'bg-fg' : 'bg-surface2 border border-line2'
        }`}
      />
      {itemBody(item)}
    </li>
  )

  const tickRow = (t) => (
    <li key={t.id} className="relative pr-4 py-2.5 pl-6">
      <span className="absolute -left-[4.75rem] top-2 w-16 text-right text-[10px] text-faint tabular-nums">
        {t.label}
      </span>
      <span className="absolute -left-[2.5px] top-3 w-1.5 h-1.5 rounded-full bg-line" />
    </li>
  )

  // "You are here." The current time, called out as the boldest, largest label in
  // the gutter, anchored to the rail with a filled dot.
  const nowRow = (n) => (
    <li key={n.id} className="relative pr-4 py-2 pl-6">
      <span className="absolute -left-[4.75rem] top-1/2 -translate-y-1/2 w-16 text-right text-sm font-bold text-fg tabular-nums">
        {formatMinShort(n._s)}
      </span>
      <span className="absolute -left-[6px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-fg ring-4 ring-surface" />
    </li>
  )

  // Rows inside a block's outline box. The gutter time labels are pushed further
  // left (the box has its own padding) so they line up with the loose rows.
  const GUT = '-left-[calc(4.75rem+32px)]'
  // The interior hour marks and the "now" label sit on the box's <li> (they span
  // its full height), one nesting level up from the start/end labels — so they
  // need 36px less offset (the li's pl-6 + the outline's px-3) to right-align with
  // them. This also keeps the big "now" label from overrunning the card's edge.
  const GUT_ROW = '-left-[calc(4.75rem-4px)]'
  // hideTime drops just the gutter time — used on the active block when "now"
  // sits close enough to the start/end that the two labels would collide (the
  // time is still shown in the block's header range).
  const boxItem = (item, hideTime, gutter) => (
    <div key={item.id} className="relative py-1.5">
      {!hideTime && (
        <span data-gutter={gutter} className={`absolute ${GUT} top-1.5 w-16 text-right text-xs text-muted tabular-nums`}>
          {item.time}
        </span>
      )}
      {itemBody(item)}
    </div>
  )
  const boxEnd = (e, hideTime) => (
    <div key={e.id} className="relative py-1.5">
      {!hideTime && (
        <span data-gutter="end" className={`absolute ${GUT} top-1 w-16 text-right text-[10px] text-faint tabular-nums`}>
          {e.label}
        </span>
      )}
      <span className="text-[10px] text-faint">{e.endTitle} ends</span>
    </div>
  )

  const boxGroup = (node) => {
    const b = node.block
    const nowKid = node.kids.find(k => k.isNow)
    const flowKids = node.kids.filter(k => !k.isNow)

    // Place "now" at its true fraction of the block's span, but keep it clear of
    // the other gutter labels so nothing ever overlaps:
    //  - the interior hour marks are hidden entirely on the active block;
    //  - if "now" lands in the top third it takes the start's spot (hide start),
    //    in the bottom third it takes the end's spot (hide end); in the middle
    //    both stay and "now" sits safely between them.
    let nowPct = null, hideStart = false, hideEnd = false
    if (nowKid) {
      const raw = ((nowKid._s - b._s) / (b.duration || 1)) * 100
      if (raw < 33) { hideStart = true; nowPct = Math.max(6, raw) }
      else if (raw > 67) { hideEnd = true; nowPct = Math.min(94, raw) }
      else nowPct = raw
    }
    return (
      <li key={node.id} className="relative pr-4 py-1.5 pl-6 list-none">
        {/* on-the-hour marks down the gutter, measured against the block's real
            height — omitted on the active block so they never crowd "now" */}
        {!nowKid && <HourMarks block={b} gutClass={GUT_ROW} />}
        {/* "now" — the current time, the largest label in the gutter, at its true
            proportional height in the block */}
        {nowKid && (
          <span
            style={{ top: `${nowPct}%` }}
            className={`absolute ${GUT_ROW} -translate-y-1/2 w-16 text-right text-sm font-bold text-fg tabular-nums z-10`}
          >
            {formatMinShort(nowKid._s)}
          </span>
        )}
        <div className="border border-line2 rounded-xl px-3 py-1.5 divide-y divide-line/60">
          {boxItem(b, hideStart, 'start')}
          {flowKids.map(k => k.isEnd ? boxEnd(k, hideEnd) : boxItem(k))}
        </div>
      </li>
    )
  }

  return (
    <section>
      <SectionHeader
        icon={<TimelineIcon />}
        title={isToday ? "Today's schedule" : dayLabel}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
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
                className="text-xs font-medium text-muted hover:text-fg border border-line2 rounded-lg px-2 py-1 transition-colors whitespace-nowrap"
              >
                Jump to today
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
              {top.map(node =>
                node.isBox ? boxGroup(node)
                  : node.isNow ? nowRow(node)
                    : node.isTick ? tickRow(node)
                      : itemRow(node),
              )}
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
