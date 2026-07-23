import { useState, useEffect } from 'react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import SectionHeader from './SectionHeader'
import TaskForm from './TaskForm'
import { recurrenceLabel } from '../lib/recurrence'
import { SNOOZE_OPTS, snoozeLabel, isSnoozed, snoozeTargetFor } from '../lib/snooze'

// Local-day ISO (YYYY-MM-DD), offset by `days`. Uses local time so "tomorrow"
// is tomorrow in Chris's zone, not UTC's.
const isoPlus = (days = 0, from = new Date()) => {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}
const prettyDate = (iso) => {
  if (!iso) return 'no date'
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}
const deletedWhen = (iso) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function TaskIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  )
}

function BellIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  )
}

function SnoozeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
    </svg>
  )
}

// Wraps a task card so it can be dragged. Hands the card its ref/style and a
// drag-handle (spread onto the grip) via a render prop.
function SortableTaskItem({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return children({ setNodeRef, style, dragHandle: { ...attributes, ...listeners } })
}

export default function TasksSection({ tasks, deletedTasks = [], onRestore, onToggleReminder, onSnooze, onUnsnooze, onToggleComplete, onAdd, onUpdate, onDelete, onDeleteSeries, onDuplicate, onReorder, highlightId, defaultDate }) {
  const [form, setForm] = useState(null) // null | 'new' | taskId
  const [confirmDelete, setConfirmDelete] = useState(null) // taskId of a repeating task
  const [dupFor, setDupFor] = useState(null)   // taskId whose "duplicate to…" picker is open
  const [dupDate, setDupDate] = useState('')   // chosen target day for the duplicate
  const [dupMsg, setDupMsg] = useState(null)   // { id, text } transient "duplicated to…" note
  const [snoozeFor, setSnoozeFor] = useState(null) // taskId whose snooze picker is open
  const [showCompleted, setShowCompleted] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)

  // Press-and-move on the grip drags; a tap/click elsewhere doesn't start a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  )

  const closeForm = () => setForm(null)

  // Push a reminder later. The notification can't carry its own buttons on iOS,
  // so snoozing lives here — and the snoozed-to state stays on the card (with an
  // Undo) rather than flashing by, so you can always see it's snoozed.
  const runSnooze = (task, opt) => {
    onSnooze(task.id, snoozeTargetFor(opt).toISOString())
    setSnoozeFor(null)
  }

  // A duplicate can land on another day (which may not be the day in view), so
  // confirm where it went instead of leaving Chris wondering if it worked.
  const runDuplicate = (task) => {
    onDuplicate(task, dupDate)
    setDupFor(null)
    setDupMsg({ id: task.id, text: `Duplicated to ${prettyDate(dupDate)}` })
    setTimeout(() => setDupMsg(m => (m?.id === task.id ? null : m)), 3000)
  }

  // Sort by the drag-reordered position (stable, so unset/equal keep their
  // creation order). Checked-off tasks then drop into their own collapsed
  // "Completed" group, so a done item never reads like a fresh standalone task.
  const ordered = [...tasks].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
  const active = ordered.filter(t => !t.completed)
  const completed = ordered.filter(t => t.completed)

  const onDragEnd = ({ active: dragged, over }) => {
    if (!over || dragged.id === over.id) return
    const from = active.findIndex(t => t.id === dragged.id)
    const to = active.findIndex(t => t.id === over.id)
    if (from !== -1 && to !== -1) onReorder(arrayMove(active, from, to).map(t => t.id))
  }

  // If a reminder deep-links to a done task, open the Completed group so the
  // highlight is actually visible.
  useEffect(() => {
    if (highlightId && completed.some(t => t.id === highlightId)) setShowCompleted(true)
  }, [highlightId, completed])

  const renderTask = (task, dragHandle) =>
    form === task.id ? (
      <TaskForm
        key={task.id}
        initial={task}
        defaultDate={defaultDate}
        onSave={(data) => { onUpdate(task.id, data); closeForm() }}
        onCancel={closeForm}
      />
    ) : (
      <div
        key={task.id}
        className={`card card-hover p-3 transition-shadow ${task.completed ? 'opacity-60' : ''} ${
          task.id === highlightId ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg' : ''
        }`}
      >
        <div className="flex items-start gap-2.5">
          {dragHandle && (
            <button
              {...dragHandle}
              aria-label="Drag to reorder"
              className="mt-0.5 text-faint hover:text-muted cursor-grab active:cursor-grabbing touch-none shrink-0"
            >
              <GripIcon />
            </button>
          )}
          <input
            type="checkbox"
            checked={task.completed}
            onChange={() => onToggleComplete(task.id)}
            className="mt-0.5 w-4 h-4 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer shrink-0"
          />

          <div className="flex-1 min-w-0">
            <h3 className={`font-medium text-sm leading-snug ${task.completed ? 'text-faint line-through' : 'text-fg'}`}>
              {task.title}
            </h3>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-xs text-muted">
              {task.time ? (
                <>
                  <span className="flex items-center gap-1"><ClockIcon /> {task.time}</span>
                  <span className="text-faint">{task.duration} min</span>
                </>
              ) : (
                <span className="text-faint">Anytime</span>
              )}
              {task.recurrence && (
                <span className="text-faint">↻ {recurrenceLabel(task.recurrence)}</span>
              )}
              {task.subtasks?.length > 0 && (
                <span className="text-faint tabular-nums">
                  {task.subtasks.filter(s => s.done).length}/{task.subtasks.length} subtasks
                </span>
              )}
              {task.isUrgent && (
                <span className="border border-line2 text-muted px-1.5 py-0.5 rounded-full text-[10px] font-medium">
                  Urgent
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            {!task.completed && (
              <button
                onClick={() => onToggleReminder(task.id)}
                aria-label={task.hasReminder ? 'Turn reminder off' : 'Turn reminder on'}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium transition-colors text-xs border ${
                  task.hasReminder
                    ? 'bg-surface2 border-line2 text-fg'
                    : 'bg-transparent border-line text-faint hover:text-muted'
                }`}
              >
                <BellIcon off={!task.hasReminder} />
                {task.hasReminder ? 'On' : 'Off'}
              </button>
            )}
            {!task.completed && task.hasReminder && onSnooze && (
              <button
                onClick={() => {
                  setSnoozeFor(snoozeFor === task.id ? null : task.id)
                  setDupFor(null); setConfirmDelete(null)
                }}
                aria-label="Snooze reminder"
                title="Snooze"
                className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                  snoozeFor === task.id ? 'text-fg bg-surface2' : 'text-faint hover:text-fg hover:bg-surface2'
                }`}
              >
                <SnoozeIcon />
              </button>
            )}
            {onDuplicate && (
              <button
                onClick={() => {
                  setDupDate(task.date || defaultDate || isoPlus(0))
                  setDupFor(dupFor === task.id ? null : task.id)
                  setConfirmDelete(null)
                }}
                aria-label="Duplicate task"
                title="Duplicate"
                className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                  dupFor === task.id ? 'text-fg bg-surface2' : 'text-faint hover:text-fg hover:bg-surface2'
                }`}
              >
                <CopyIcon />
              </button>
            )}
            <button
              onClick={() => setForm(task.id)}
              aria-label="Edit task"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-faint hover:text-fg hover:bg-surface2 transition-colors"
            >
              <EditIcon />
            </button>
            <button
              onClick={() => task.seriesId ? setConfirmDelete(task.id) : onDelete(task.id)}
              aria-label="Delete task"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-faint hover:text-fg hover:bg-surface2 transition-colors"
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        {/* Duplicate to a chosen day — quick presets plus a date field, so a
            block can be reused on the next shoot day without retyping it. */}
        {dupFor === task.id && (
          <div className="mt-3 pt-3 border-t border-line space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">Duplicate to…</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setDupDate(task.date || defaultDate || isoPlus(0))}
                  className={`text-xs px-2 py-1 rounded-lg border transition-colors ${dupDate === (task.date || defaultDate) ? 'border-line2 text-fg bg-surface2' : 'border-line text-muted hover:text-fg'}`}
                >
                  Same day
                </button>
                <button
                  onClick={() => setDupDate(isoPlus(1))}
                  className={`text-xs px-2 py-1 rounded-lg border transition-colors ${dupDate === isoPlus(1) ? 'border-line2 text-fg bg-surface2' : 'border-line text-muted hover:text-fg'}`}
                >
                  Tomorrow
                </button>
                <button
                  onClick={() => setDupDate(isoPlus(7))}
                  className={`text-xs px-2 py-1 rounded-lg border transition-colors ${dupDate === isoPlus(7) ? 'border-line2 text-fg bg-surface2' : 'border-line text-muted hover:text-fg'}`}
                >
                  Next week
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <input
                type="date"
                value={dupDate}
                onChange={e => setDupDate(e.target.value)}
                className="input py-1 text-xs"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setDupFor(null)}
                  className="text-xs px-2.5 py-1 rounded-lg text-faint hover:text-fg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => runDuplicate(task)}
                  disabled={!dupDate}
                  className="text-xs px-2.5 py-1 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  Duplicate
                </button>
              </div>
            </div>
          </div>
        )}

        {dupMsg?.id === task.id && (
          <div className="mt-3 pt-3 border-t border-line flex items-center gap-1.5 text-xs text-muted">
            <CopyIcon /> {dupMsg.text}
          </div>
        )}

        {/* Snooze — push this reminder later. Confirms the new fire time. */}
        {snoozeFor === task.id && (
          <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-2">
            <span className="text-xs text-muted flex items-center gap-1.5"><SnoozeIcon /> Snooze…</span>
            <div className="flex gap-1.5">
              {SNOOZE_OPTS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => runSnooze(task, opt)}
                  className="text-xs px-2 py-1 rounded-lg border border-line text-muted hover:text-fg hover:border-line2 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Persistent "this is snoozed" state, with a way to take it back. */}
        {isSnoozed(task) && snoozeFor !== task.id && (
          <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-2">
            <span className="text-xs text-muted flex items-center gap-1.5">
              <SnoozeIcon /> Snoozed to {snoozeLabel(task.remindAt)}
            </span>
            <button
              onClick={() => onUnsnooze(task.id)}
              className="text-xs px-2 py-1 rounded-lg border border-line text-muted hover:text-fg hover:border-line2 transition-colors"
            >
              Undo
            </button>
          </div>
        )}

        {/* Repeating tasks: delete just today's, or stop the series here. */}
        {confirmDelete === task.id && (
          <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted">This task repeats — delete…</span>
            <div className="flex gap-2">
              <button
                onClick={() => { onDelete(task.id); setConfirmDelete(null) }}
                className="text-xs px-2.5 py-1 rounded-lg border border-line2 text-muted hover:text-fg transition-colors"
              >
                Just this one
              </button>
              <button
                onClick={() => { onDeleteSeries(task.seriesId, task.date); setConfirmDelete(null) }}
                className="text-xs px-2.5 py-1 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity"
              >
                This & all future
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="text-xs text-faint hover:text-fg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    )

  return (
    <section>
      <SectionHeader
        icon={<TaskIcon />}
        title="Today's tasks"
        count={active.length}
        action={
          <button
            onClick={() => setForm('new')}
            className="flex items-center gap-1 text-xs font-medium text-muted hover:text-fg border border-line2 rounded-lg px-2.5 py-1 transition-colors"
          >
            <PlusIcon /> Add
          </button>
        }
      />

      <div className="space-y-2">
        {form === 'new' && (
          <TaskForm
            defaultDate={defaultDate}
            onSave={(data) => { onAdd(data); closeForm() }}
            onCancel={closeForm}
          />
        )}

        {onReorder ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={active.map(t => t.id)} strategy={verticalListSortingStrategy}>
              {active.map(task => (
                <SortableTaskItem key={task.id} id={task.id}>
                  {({ setNodeRef, style, dragHandle }) => (
                    <div ref={setNodeRef} style={style}>
                      {renderTask(task, form === task.id ? null : dragHandle)}
                    </div>
                  )}
                </SortableTaskItem>
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          active.map(t => renderTask(t))
        )}
      </div>

      {active.length === 0 && completed.length === 0 && form !== 'new' && (
        <div className="card">
          <p className="text-muted">No to-dos here.</p>
          <p className="text-xs text-faint mt-1">This is for untimed tasks — anything with a set time lives on your schedule above.</p>
        </div>
      )}

      {/* Done tasks live here, collapsed, so they don't clutter the active list. */}
      {completed.length > 0 && (
        <div className="mt-5">
          <button
            onClick={() => setShowCompleted(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-faint hover:text-muted transition-colors"
          >
            <span className={`transition-transform ${showCompleted ? 'rotate-90' : ''}`}>›</span>
            Completed ({completed.length})
          </button>
          {showCompleted && (
            <div className="space-y-2 mt-3">
              {completed.map(t => renderTask(t))}
            </div>
          )}
        </div>
      )}

      {/* The permanent net: anything deleted in the last 30 days, restorable.
          Not day-filtered — a deleted task is findable no matter what you're
          viewing. After 30 days they purge for real. */}
      {deletedTasks.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowDeleted(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-faint hover:text-muted transition-colors"
          >
            <span className={`transition-transform ${showDeleted ? 'rotate-90' : ''}`}>›</span>
            Recently deleted ({deletedTasks.length})
          </button>
          {showDeleted && (
            <div className="space-y-2 mt-3">
              {deletedTasks.map(t => (
                <div key={t.id} className="card p-3 opacity-70 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-muted truncate">{t.title}</p>
                    <p className="text-xs text-faint mt-0.5">
                      {t.date ? prettyDate(t.date) : 'no date'}{t.time ? ` · ${t.time}` : ''} — deleted {deletedWhen(t.deletedAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => onRestore(t.id)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-line2 text-muted hover:text-fg transition-colors shrink-0"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
