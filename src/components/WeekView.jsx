import { useState } from 'react'
import SectionHeader from './SectionHeader'
import ViewSwitcher from './ViewSwitcher'
import TaskForm from './TaskForm'
import { weekDays, addDays, toISODate, toMinutes, isSameDay } from '../lib/dates'

function WeekIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </svg>
  )
}

export default function WeekView({
  tasks,
  events,
  selectedDate,
  onChangeDate,
  onAddTask,
  onToggleComplete,
  view,
  onChangeView,
  calendarLoading,
  calendarError,
}) {
  const [addingDate, setAddingDate] = useState(null)
  const days = weekDays(selectedDate)
  const today = new Date()

  const itemsFor = (iso) => [
    ...tasks.filter(t => t.date === iso).sort((a, b) => toMinutes(a.time) - toMinutes(b.time)).map(t => ({
      key: `t-${t.id}`, id: t.id, title: t.title, time: t.time,
      kind: 'task', done: t.completed,
    })),
    ...events.filter(e => e.date === iso).map(e => ({
      key: `e-${e.id}`, title: e.title, time: e.time, kind: 'event',
    })),
  ].sort((a, b) => toMinutes(a.time) - toMinutes(b.time))

  const rangeLabel = `${days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  return (
    <section>
      <SectionHeader
        icon={<WeekIcon />}
        title={rangeLabel}
        action={
          <div className="flex items-center gap-2">
            <ViewSwitcher value={view} onChange={onChangeView} />
            <div className="flex items-center gap-1">
              <button
                onClick={() => onChangeDate(addDays(selectedDate, -7))}
                aria-label="Previous week"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-faint hover:text-fg hover:bg-surface2 transition-colors"
              >
                ‹
              </button>
              <button
                onClick={() => onChangeDate(new Date())}
                className="text-xs font-medium text-muted hover:text-fg border border-line2 rounded-lg px-2 py-1 transition-colors"
              >
                This week
              </button>
              <button
                onClick={() => onChangeDate(addDays(selectedDate, 7))}
                aria-label="Next week"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-faint hover:text-fg hover:bg-surface2 transition-colors"
              >
                ›
              </button>
            </div>
          </div>
        }
      />

      <p className="text-xs text-faint -mt-2 mb-3">
        {calendarLoading
          ? 'Syncing calendar…'
          : calendarError
            ? `Calendar error: ${calendarError}`
            : 'Plan the week — click a day to open it, or + to add a task.'}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
        {days.map(day => {
          const iso = toISODate(day)
          const items = itemsFor(iso)
          const isToday = isSameDay(day, today)
          return (
            <div
              key={iso}
              className={`card p-2 min-h-[7rem] flex flex-col ${isToday ? 'ring-1 ring-line2' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => { onChangeDate(day); onChangeView('day') }}
                  className="text-left group"
                >
                  <div className={`text-xs ${isToday ? 'text-fg' : 'text-faint'}`}>
                    {day.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div className={`text-sm font-medium tabular-nums group-hover:text-fg transition-colors ${isToday ? 'text-fg' : 'text-muted'}`}>
                    {day.getDate()}
                  </div>
                </button>
                <button
                  onClick={() => setAddingDate(iso)}
                  aria-label={`Add task on ${iso}`}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-faint hover:text-fg hover:bg-surface2 transition-colors"
                >
                  +
                </button>
              </div>

              <div className="space-y-1 flex-1">
                {items.length === 0 ? (
                  <p className="text-xs text-faint/60">—</p>
                ) : (
                  items.map(item => (
                    <div key={item.key} className="flex items-start gap-1.5">
                      {item.kind === 'task' ? (
                        <input
                          type="checkbox"
                          checked={item.done}
                          onChange={() => onToggleComplete(item.id)}
                          className="mt-0.5 w-3 h-3 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer shrink-0"
                        />
                      ) : (
                        <span className="mt-1 w-1.5 h-1.5 rounded-full bg-fg shrink-0" />
                      )}
                      <span className={`text-xs leading-tight ${item.done ? 'line-through text-faint' : 'text-muted'}`}>
                        {item.title}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {addingDate && (
        <div className="mt-3">
          <p className="text-xs text-faint mb-2">
            Adding to {new Date(`${addingDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
          <TaskForm
            defaultDate={addingDate}
            onSave={(data) => { onAddTask(data); setAddingDate(null) }}
            onCancel={() => setAddingDate(null)}
          />
        </div>
      )}
    </section>
  )
}
