import { useState } from 'react'
import TaskForm from './TaskForm'

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 2l1.6 4.6L18 8l-4.4 1.4L12 14l-1.6-4.6L6 8l4.4-1.4L12 2zM19 14l.9 2.6L22 17l-2.1.4L19 20l-.9-2.6L16 17l2.1-.4L19 14z" />
    </svg>
  )
}

const prettyDate = (iso) => {
  if (!iso) return 'no date'
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/* The A.I. assistant, as a floating launcher pinned bottom-left. Describe a task
   in plain words and Claude structures it; reference an existing task ("push my
   2pm edit to 4", "rough cut is done") and it proposes the change. Nothing is
   ever applied without a tap: create opens the pre-filled form, update/complete
   show a confirm card. */
export default function AssistantLauncher({ onCommand, onAdd, onUpdate, onComplete, onDuplicate, defaultDate }) {
  const [open, setOpen] = useState(false)       // the text box is open
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState(null)
  const [prefill, setPrefill] = useState(null)  // create → pre-filled form
  const [confirm, setConfirm] = useState(null)  // update/complete → confirm card

  const reset = () => { setPrefill(null); setConfirm(null); setText(''); setError(null); setOpen(false) }

  const submit = async (e) => {
    e.preventDefault()
    if (!text.trim() || parsing) return
    setParsing(true); setError(null)
    try {
      const c = await onCommand(text.trim())
      if (c.intent === 'create') {
        setPrefill({
          title: c.title,
          date: c.date,
          time: c.time,
          duration: c.durationMin || 30,
          hasReminder: c.reminder,
          subtasks: (c.subtasks || []).map(t => ({ id: Math.random().toString(36).slice(2, 9), title: t, done: false })),
        })
        setOpen(false)
      } else if ((c.intent === 'update' || c.intent === 'complete' || c.intent === 'duplicate') && c.task) {
        setConfirm(c)
        setOpen(false)
      } else {
        setError(c.note || 'Could not match that to anything — try being more specific.')
      }
    } catch (err) {
      setError(err.message || 'Could not read that — try rephrasing.')
    } finally {
      setParsing(false)
    }
  }

  // Apply a confirmed update/complete/duplicate — the one place the assistant
  // touches data.
  const applyConfirm = () => {
    const c = confirm
    if (!c?.task) { reset(); return }
    if (c.intent === 'complete') {
      onComplete(c.task.id)
    } else if (c.intent === 'duplicate') {
      // Full copy — duration, reminder settings, fresh subtasks — onto the
      // target day, keeping the original's time unless a new one was given.
      onDuplicate(c.task, c.date ?? c.task.date, c.time || undefined)
    } else {
      const changes = {}
      if (c.title) changes.title = c.title
      if (c.date) changes.date = c.date
      if (c.time) changes.time = c.time
      if (c.durationMin) changes.duration = c.durationMin
      onUpdate(c.task.id, changes)
    }
    reset()
  }

  // One before→after row in the confirm card.
  const changeRow = (label, from, to) => (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-faint w-16 shrink-0">{label}</span>
      <span className="text-faint line-through">{from}</span>
      <span className="text-faint">→</span>
      <span className="text-fg">{to}</span>
    </div>
  )

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true) }}
        aria-label="Open A.I. assistant"
        className="fixed bottom-5 left-5 z-40 flex items-center gap-2 pl-3.5 pr-4 py-2.5 rounded-full bg-accent text-accent-fg text-sm font-medium shadow-lg shadow-black/30 hover:opacity-90 transition-opacity"
      >
        <SparkleIcon /> A.I. assistant
      </button>

      {/* Describe-it box */}
      {open && !prefill && !confirm && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50"
          onClick={() => setOpen(false)}
        >
          <form
            onClick={e => e.stopPropagation()}
            onSubmit={submit}
            className="w-full max-w-lg bg-surface border border-line2 rounded-2xl shadow-xl p-4"
          >
            <div className="flex items-center gap-2 mb-2 text-sm font-medium text-fg">
              <SparkleIcon /> A.I. assistant
            </div>
            <textarea
              autoFocus
              rows={3}
              value={text}
              onChange={e => { setText(e.target.value); setError(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e) }}
              placeholder="Add, change, or finish a task — “2h edit tomorrow 10am”, “push my 2pm edit to 4”, “rough cut is done”"
              className="input w-full text-sm resize-none"
            />
            {error && <p className="text-xs text-muted mt-2">{error}</p>}
            <div className="flex items-center justify-between gap-2 mt-3">
              <span className="text-xs text-faint">Your A.I. assistant constructs it — you confirm before it saves.</span>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={parsing || !text.trim()}
                  className="px-4 py-1.5 text-sm rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {parsing ? 'Reading…' : 'Continue'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Pre-filled task form to confirm a CREATE */}
      {prefill && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/50 overflow-y-auto"
          onClick={reset}
        >
          <div onClick={e => e.stopPropagation()} className="w-full max-w-lg my-8">
            <TaskForm
              initial={prefill}
              defaultDate={defaultDate}
              onSave={(data) => { onAdd(data); reset() }}
              onCancel={reset}
            />
          </div>
        </div>
      )}

      {/* Confirm card for an UPDATE / COMPLETE of an existing task */}
      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50"
          onClick={reset}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg bg-surface border border-line2 rounded-2xl shadow-xl p-4"
          >
            <div className="flex items-center gap-2 mb-2 text-sm font-medium text-fg">
              <SparkleIcon /> A.I. assistant
            </div>
            <p className="text-sm text-fg">{confirm.note || `Update “${confirm.task.title}”?`}</p>

            <div className="mt-3 rounded-xl border border-line2 bg-surface2/30 p-3 space-y-1.5">
              <p className="text-sm font-medium text-fg">{confirm.task.title}</p>
              {confirm.intent === 'complete' ? (
                <p className="text-xs text-muted">Will be marked complete.</p>
              ) : confirm.intent === 'duplicate' ? (
                <p className="text-xs text-muted">
                  A copy will be added on <span className="text-fg">{prettyDate(confirm.date ?? confirm.task.date)}</span>
                  {' '}at <span className="text-fg">{confirm.time || confirm.task.time || 'anytime'}</span>
                  {confirm.task.subtasks?.length
                    ? ` — with ${confirm.task.subtasks.length} fresh subtask${confirm.task.subtasks.length === 1 ? '' : 's'}`
                    : ''}. The original stays where it is.
                </p>
              ) : (
                <>
                  {confirm.date && changeRow('Date', prettyDate(confirm.task.date), prettyDate(confirm.date))}
                  {confirm.time && changeRow('Time', confirm.task.time || 'anytime', confirm.time)}
                  {confirm.durationMin > 0 && changeRow('Duration', `${confirm.task.duration} min`, `${confirm.durationMin} min`)}
                  {confirm.title && changeRow('Title', confirm.task.title, confirm.title)}
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                onClick={reset}
                className="px-3 py-1.5 text-sm rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={applyConfirm}
                className="px-4 py-1.5 text-sm rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity"
              >
                {confirm.intent === 'complete' ? 'Mark done' : confirm.intent === 'duplicate' ? 'Add copy' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
