import { useState } from 'react'
import TaskForm from './TaskForm'

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 2l1.6 4.6L18 8l-4.4 1.4L12 14l-1.6-4.6L6 8l4.4-1.4L12 2zM19 14l.9 2.6L22 17l-2.1.4L19 20l-.9-2.6L16 17l2.1-.4L19 14z" />
    </svg>
  )
}

/* The AI quick-add, as a floating launcher pinned bottom-left. Tap it, describe a
   task in plain words, and Claude structures it — then the task form opens
   pre-filled so Chris confirms and saves. It never creates anything on its own. */
export default function AssistantLauncher({ onParseTask, onAdd, defaultDate }) {
  const [open, setOpen] = useState(false)       // the text box is open
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState(null)
  const [prefill, setPrefill] = useState(null)  // parsed task → pre-filled form

  const reset = () => { setPrefill(null); setText(''); setError(null); setOpen(false) }

  const submit = async (e) => {
    e.preventDefault()
    if (!text.trim() || parsing) return
    setParsing(true); setError(null)
    try {
      const parsed = await onParseTask(text.trim())
      setPrefill(parsed)
      setOpen(false)
    } catch (err) {
      setError(err.message || 'Could not read that — try rephrasing.')
    } finally {
      setParsing(false)
    }
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true) }}
        aria-label="Quick add a task"
        className="fixed bottom-5 left-5 z-40 flex items-center gap-2 pl-3.5 pr-4 py-2.5 rounded-full bg-accent text-accent-fg text-sm font-medium shadow-lg shadow-black/30 hover:opacity-90 transition-opacity"
      >
        <SparkleIcon /> Quick add
      </button>

      {/* Describe-it box */}
      {open && !prefill && (
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
              <SparkleIcon /> Quick add
            </div>
            <textarea
              autoFocus
              rows={3}
              value={text}
              onChange={e => { setText(e.target.value); setError(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e) }}
              placeholder="Describe a task — “2h edit tomorrow 10am, subtasks pull selects, rough cut, color”"
              className="input w-full text-sm resize-none"
            />
            {error && <p className="text-xs text-muted mt-2">{error}</p>}
            <div className="flex items-center justify-between gap-2 mt-3">
              <span className="text-xs text-faint">Claude structures it — you confirm before it saves.</span>
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

      {/* Pre-filled task form to confirm */}
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
    </>
  )
}
