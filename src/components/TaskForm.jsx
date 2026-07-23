import { useState, useEffect } from 'react'
import { RECURRENCE_OPTIONS, DAY_LABELS, encodeWeekly } from '../lib/recurrence'
import useTemplates from '../hooks/useTemplates'

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

// A minutes picker with presets + a "Custom…" number entry. Used for the
// reminder's lead time and its repeat interval.
function MinutesSelect({ label, suffix, value, onChange, presets }) {
  const isPreset = presets.some(p => p.v === value)
  const [custom, setCustom] = useState(!isPreset)
  // The custom field keeps its own text so it can be emptied while you type a new
  // number — clamping the number on every keystroke would trap the old digit and
  // stop you erasing it. We push valid numbers up live and enforce the floor on blur.
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  return (
    <label className="flex flex-col gap-1 text-xs text-faint">
      {label}
      <div className="flex items-center gap-2">
        <select
          value={custom ? 'custom' : String(value)}
          onChange={e => {
            if (e.target.value === 'custom') { setCustom(true); onChange(value || presets[1]?.v || 15) }
            else { setCustom(false); onChange(Number(e.target.value)) }
          }}
          className="input"
        >
          {presets.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {custom && (
          <span className="flex items-center gap-1">
            <input
              type="number" min="1" step="1"
              value={draft}
              onChange={e => {
                setDraft(e.target.value)                 // may be empty mid-edit
                const n = Number(e.target.value)
                if (e.target.value !== '' && Number.isFinite(n) && n >= 1) onChange(n)
              }}
              onBlur={() => {                            // settle on a valid number
                const n = Math.max(1, Math.round(Number(draft) || 1))
                setDraft(String(n)); onChange(n)
              }}
              className="input w-16"
            />
            <span className="text-faint">{suffix}</span>
          </span>
        )}
      </div>
    </label>
  )
}

const LEAD_PRESETS = [
  { v: 0, label: 'At start time' },
  { v: 5, label: '5 min before' },
  { v: 10, label: '10 min before' },
  { v: 30, label: '30 min before' },
  { v: 60, label: '1 hour before' },
]
const REPEAT_PRESETS = [
  { v: 0, label: "Don't repeat" },
  { v: 30, label: 'Every 30 min' },
  { v: 60, label: 'Every 1 hour' },
  { v: 120, label: 'Every 2 hours' },
]

export default function TaskForm({ initial, defaultDate, onSave, onCancel }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [date, setDate] = useState(initial?.date || defaultDate)
  const [time, setTime] = useState(initial ? displayTo24(initial.time) : '09:00')
  const [duration, setDuration] = useState(initial?.duration ?? 30)
  const [hasReminder, setHasReminder] = useState(initial?.hasReminder ?? false)
  const [reminderLeadMin, setReminderLeadMin] = useState(initial?.reminderLeadMin ?? 0)
  const [reminderRepeatMin, setReminderRepeatMin] = useState(initial?.reminderRepeatMin ?? 0)
  const [unscheduled, setUnscheduled] = useState(initial ? !initial.date : false)
  // Repeats are chosen when creating; editing one occurrence doesn't reshape the series.
  const [recurrence, setRecurrence] = useState('')
  // Default the weekly picker to the day the task itself falls on.
  const [weeklyDays, setWeeklyDays] = useState(
    () => [new Date(`${initial?.date || defaultDate}T00:00:00`).getDay()]
  )
  const isEditing = Boolean(initial?.id)
  // Repeat is offered when creating AND when editing a one-off (saving then
  // spawns the series from its day). Tasks already in a series never reshape
  // the series from one occurrence's edit form.
  const canRepeat = !initial?.seriesId

  const { templates, saveTemplate, deleteTemplate } = useTemplates()
  const [tplMsg, setTplMsg] = useState(null)   // 'Template saved ✓' | the real error

  const toggleWeekday = (d) =>
    setWeeklyDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])

  const resolvedRecurrence = () => {
    if (unscheduled || !canRepeat || !recurrence) return null
    if (recurrence === 'weekly') {
      return weeklyDays.length ? encodeWeekly(weeklyDays) : null
    }
    return recurrence
  }

  // Drop a template's blueprint into the form — everything but date/time.
  const applyTemplate = (t) => {
    setTitle(t.title)
    setDuration(t.duration ?? 30)
    setHasReminder(Boolean(t.has_reminder))
    setReminderLeadMin(t.reminder_lead_min ?? 0)
    setReminderRepeatMin(t.reminder_repeat_min ?? 0)
    setSubtasks((t.subtasks || []).map(s => ({ id: uid(), title: s.title, done: false })))
  }

  // Save the form's current shape as a template (named after its title). A
  // failure shows the real error — a silent no-op just looks broken.
  const saveAsTemplate = async () => {
    if (!title.trim()) return
    const res = await saveTemplate({
      name: title.trim(),
      title: title.trim(),
      duration: Number(duration) || 30,
      hasReminder,
      reminderLeadMin,
      reminderRepeatMin,
      subtasks: subtasks.filter(s => s.title.trim()),
    })
    setTplMsg(res.ok ? 'Template saved ✓' : `Couldn't save template: ${res.error || 'unknown error'}`)
    setTimeout(() => setTplMsg(null), res.ok ? 2500 : 8000)
  }
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
      recurrence: resolvedRecurrence(),
      hasReminder,
      reminderLeadMin: hasReminder ? reminderLeadMin : 0,
      reminderRepeatMin: hasReminder ? reminderRepeatMin : 0,
      subtasks: subtasks
        .map(s => ({ ...s, title: s.title.trim() }))
        .filter(s => s.title),
    })
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      {/* Saved blueprints — one tap pre-fills everything but the date/time. */}
      {!isEditing && templates.length > 0 && (
        <div>
          <p className="text-xs text-faint mb-1.5">Start from a template</p>
          <div className="flex flex-wrap gap-1.5">
            {templates.map(t => (
              <span key={t.id} className="flex items-center gap-1 bg-surface2 border border-line2 rounded-lg pl-2.5 pr-1 py-1">
                <button type="button" onClick={() => applyTemplate(t)} className="text-xs text-fg">
                  {t.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteTemplate(t.id)}
                  aria-label={`Delete template ${t.name}`}
                  title="Delete template"
                  className="w-4 h-4 flex items-center justify-center rounded text-faint hover:text-fg transition-colors"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

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

      {/* Reminder timing — when to first buzz, and whether to keep buzzing. */}
      {!unscheduled && hasReminder && (
        <div className="flex flex-wrap gap-3 rounded-xl border border-line2 bg-surface2/30 p-3">
          <MinutesSelect
            label="Remind me" suffix="min before"
            value={reminderLeadMin} onChange={setReminderLeadMin} presets={LEAD_PRESETS}
          />
          <MinutesSelect
            label="Repeat" suffix="min apart"
            value={reminderRepeatMin} onChange={setReminderRepeatMin} presets={REPEAT_PRESETS}
          />
        </div>
      )}

      {!unscheduled && canRepeat && (
        <div className="space-y-2">
          <label className="flex flex-col gap-1 text-xs text-faint">
            Repeat
            <select
              value={recurrence}
              onChange={e => setRecurrence(e.target.value)}
              className="input"
            >
              {RECURRENCE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          {recurrence === 'weekly' && (
            <div>
              <div className="flex gap-1">
                {DAY_LABELS.map((label, d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleWeekday(d)}
                    aria-pressed={weeklyDays.includes(d)}
                    className={`w-8 h-8 rounded-full text-xs font-medium transition-colors ${
                      weeklyDays.includes(d)
                        ? 'bg-accent text-accent-fg'
                        : 'border border-line2 text-muted hover:text-fg'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {weeklyDays.length === 0 && (
                <p className="text-xs text-faint mt-1.5">Pick at least one day.</p>
              )}
            </div>
          )}
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

      <div className="flex items-center justify-between gap-2">
        {/* Keep this shape for reuse — becomes a chip on future task forms. */}
        <button
          type="button"
          onClick={saveAsTemplate}
          disabled={!title.trim() || Boolean(tplMsg)}
          className="text-xs text-faint hover:text-fg transition-colors disabled:opacity-60 text-left min-w-0"
        >
          {tplMsg || 'Save as template'}
        </button>
        <div className="flex gap-2 shrink-0">
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
      </div>
    </form>
  )
}
