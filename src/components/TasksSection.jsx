import { useState } from 'react'
import SectionHeader from './SectionHeader'
import TaskForm from './TaskForm'

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

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
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

export default function TasksSection({ tasks, onToggleReminder, onToggleComplete, onAdd, onUpdate, onDelete, defaultDate }) {
  const [form, setForm] = useState(null) // null | 'new' | taskId

  const closeForm = () => setForm(null)

  return (
    <section>
      <SectionHeader
        icon={<TaskIcon />}
        title="Today's tasks"
        count={tasks.filter(t => !t.completed).length}
        action={
          <button
            onClick={() => setForm('new')}
            className="flex items-center gap-1 text-xs font-medium text-muted hover:text-fg border border-line2 rounded-lg px-2.5 py-1 transition-colors"
          >
            <PlusIcon /> Add
          </button>
        }
      />

      <div className="space-y-3">
        {form === 'new' && (
          <TaskForm
            defaultDate={defaultDate}
            onSave={(data) => { onAdd(data); closeForm() }}
            onCancel={closeForm}
          />
        )}

        {tasks.map(task =>
          form === task.id ? (
            <TaskForm
              key={task.id}
              initial={task}
              defaultDate={defaultDate}
              onSave={(data) => { onUpdate(task.id, data); closeForm() }}
              onCancel={closeForm}
            />
          ) : (
            <div key={task.id} className={`card card-hover ${task.completed ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => onToggleComplete(task.id)}
                  className="mt-0.5 w-5 h-5 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />

                <div className="flex-1 min-w-0">
                  <h3 className={`font-medium ${task.completed ? 'text-faint line-through' : 'text-fg'}`}>
                    {task.title}
                  </h3>
                  <div className="flex items-center gap-3 mt-2 text-sm text-muted">
                    {task.time ? (
                      <>
                        <span className="flex items-center gap-1.5"><ClockIcon /> {task.time}</span>
                        <span className="text-faint">{task.duration} min</span>
                      </>
                    ) : (
                      <span className="text-faint">Anytime</span>
                    )}
                    {task.subtasks?.length > 0 && (
                      <span className="text-faint tabular-nums">
                        {task.subtasks.filter(s => s.done).length}/{task.subtasks.length} subtasks
                      </span>
                    )}
                    {task.isUrgent && (
                      <span className="border border-line2 text-muted px-2 py-0.5 rounded-full text-xs font-medium">
                        Urgent
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onToggleReminder(task.id)}
                    aria-label={task.hasReminder ? 'Turn reminder off' : 'Turn reminder on'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors text-sm border ${
                      task.hasReminder
                        ? 'bg-surface2 border-line2 text-fg'
                        : 'bg-transparent border-line text-faint hover:text-muted'
                    }`}
                  >
                    <BellIcon off={!task.hasReminder} />
                    {task.hasReminder ? 'On' : 'Off'}
                  </button>
                  <button
                    onClick={() => setForm(task.id)}
                    aria-label="Edit task"
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-faint hover:text-fg hover:bg-surface2 transition-colors"
                  >
                    <EditIcon />
                  </button>
                  <button
                    onClick={() => onDelete(task.id)}
                    aria-label="Delete task"
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-faint hover:text-fg hover:bg-surface2 transition-colors"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            </div>
          )
        )}
      </div>

      {tasks.length === 0 && form !== 'new' && (
        <div className="card">
          <p className="text-muted">No tasks yet. Add one to start structuring your day.</p>
        </div>
      )}
    </section>
  )
}
