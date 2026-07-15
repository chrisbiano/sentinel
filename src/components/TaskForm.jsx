import { useState } from 'react'

const uid = () => Math.random().toString(36).slice(2, 9)

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function displayTo24(t) {
  const m = String(t).match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return '09:00'
  let h = Number(m[1]) % 12
  if (/pm/i.test(m[3])) h += 12
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

function to24Display(hhmm) {
  const [H, M] = String(hhmm).split(':').map(Number)
  const ampm = H < 12 ? 'AM' : 'PM'
  const h12 = H % 12 === 0 ? 12 : H % 12
  return `${h12}:${String(M || 0).padStart(2, '0')} ${ampm}`
}

export default function TaskForm({ initial, defaultDate, onSave, onCancel }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [date, setDate] = useState(initial?.date || defaultDate)
  const [time, setTime] = useState(initial ? displayTo24(initial.time) : '09:00')
  const [duration, setDuration] = useState(initial?.duration ?? 30)
  const [hasReminder, setHasReminder] = useState(initial?.hasReminder ?? false)
  // An existing task with no date came from the Inbox.
  const [unscheduled, setUnscheduled] = useState(initial ? !initial.date : false)
  const [subtasks, setSubtasks] = useState(
    initial?.subtasks?.map(s => ({ ...s })) ?? []
  )

  const addSubtask = () => setSubtasks(prev => [...prev, { id: uid(), title: '', done: false }])
  const updateSubtask = (id, value) =>
    setSubtasks(prev => prev.map(s => (s.id === id ? { ...s, title: value } : s)))
  const removeSubtask = (id) => setSubtasks(prev => prev.filter(s => s.id !== id))

  const submit = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    onSave({
      title: title.trim(),
      date: unscheduled ? null : date,
      time: unscheduled ? null : to24Display(time),
      duration: Number(duration) || 30,
      hasReminder,
      subtasks: subtasks
        .map(s => ({ ...s, title: s.title.trim() }))
        .filter(s => s.title),
    })
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Task title"
        className="input w-full"
      />
      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={unscheduled}
          onChange={e => setUnscheduled(e.target.checked)}
          className="w-4 h-4 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0"
        />
        No date or time — just a general task
      </label>

      {!unscheduled && (
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-faint">
          Date
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">
          Start
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-faint">
          Duration (min)
          <input
            type="number"
            min="5"
            step="5"
            value={duration}
            onChange={e => setDuration(e.target.value)}
            className="input w-28"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted self-end pb-2">
          <input
            type="checkbox"
            checked={hasReminder}
            onChange={e => setHasReminder(e.target.checked)}
            className="w-4 h-4 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0"
          />
          Reminder
        </label>
      </div>
      )}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-faint">Subtasks</span>
          <button
            type="button"
            onClick={addSubtask}
            className="flex items-center gap-1 text-xs text-muted hover:text-fg transition-colors"
          >
            <PlusIcon /> Add subtask
          </button>
        </div>
        {subtasks.map(s => (
          <div key={s.id} className="flex items-center gap-2">
            <input
              value={s.title}
              onChange={e => updateSubtask(s.id, e.target.value)}
              placeholder="Subtask"
              className="input flex-1 py-1.5"
            />
            <button
              type="button"
              onClick={() => removeSubtask(s.id)}
              aria-label="Remove subtask"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-faint hover:text-fg hover:bg-surface2 transition-colors shrink-0"
            >
              <XIcon />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="px-3 py-1.5 text-sm rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </form>
  )
}
