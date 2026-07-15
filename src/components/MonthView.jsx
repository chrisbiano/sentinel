import SectionHeader from './SectionHeader'
import ViewSwitcher from './ViewSwitcher'
import { monthGrid, addMonths, toISODate, toMinutes, isSameDay } from '../lib/dates'

function MonthIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
      <path d="M7 14h.01M12 14h.01M17 14h.01M7 18h.01M12 18h.01" />
    </svg>
  )
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function MonthView({
  tasks,
  events,
  selectedDate,
  onChangeDate,
  onChangeView,
  view,
  calendarLoading,
  calendarError,
}) {
  const cells = monthGrid(selectedDate)
  const today = new Date()
  const month = selectedDate.getMonth()

  const itemsFor = (iso) => [
    ...tasks.filter(t => t.date === iso).map(t => ({
      key: `t-${t.id}`, title: t.title, time: t.time, kind: 'task', done: t.completed,
    })),
    ...events.filter(e => e.date === iso).map(e => ({
      key: `e-${e.id}`, title: e.title, time: e.time, kind: 'event',
    })),
  ].sort((a, b) => toMinutes(a.time) - toMinutes(b.time))

  const openDay = (day) => { onChangeDate(day); onChangeView('day') }

  return (
    <section>
      <SectionHeader
        icon={<MonthIcon />}
        title={selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        action={
          <div className="flex items-center gap-2">
            <ViewSwitcher value={view} onChange={onChangeView} />
            <div className="flex items-center gap-1">
              <button
                onClick={() => onChangeDate(addMonths(selectedDate, -1))}
                aria-label="Previous month"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-faint hover:text-fg hover:bg-surface2 transition-colors"
              >
                ‹
              </button>
              <button
                onClick={() => onChangeDate(new Date())}
                className="text-xs font-medium text-muted hover:text-fg border border-line2 rounded-lg px-2 py-1 transition-colors"
              >
                Today
              </button>
              <button
                onClick={() => onChangeDate(addMonths(selectedDate, 1))}
                aria-label="Next month"
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
            : 'Tap any day to open it.'}
      </p>

      <div className="card p-2 sm:p-3">
        {/* weekday header */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-[10px] sm:text-xs text-faint text-center py-1">
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map(day => {
            const iso = toISODate(day)
            const items = itemsFor(iso)
            const inMonth = day.getMonth() === month
            const isToday = isSameDay(day, today)
            return (
              <button
                key={iso}
                onClick={() => openDay(day)}
                className={`text-left rounded-lg border p-1 sm:p-1.5 min-h-[3.25rem] sm:min-h-[5rem] transition-colors ${
                  isToday ? 'border-line2 bg-surface2' : 'border-line hover:bg-surface2'
                } ${inMonth ? '' : 'opacity-40'}`}
              >
                <div className={`text-[11px] sm:text-xs tabular-nums ${isToday ? 'text-fg font-medium' : 'text-muted'}`}>
                  {day.getDate()}
                </div>

                {/* Titles where there's room; dots on narrow screens. */}
                <div className="hidden sm:block mt-1 space-y-0.5">
                  {items.slice(0, 2).map(item => (
                    <div
                      key={item.key}
                      className={`text-[10px] leading-tight truncate ${
                        item.done ? 'line-through text-faint' : 'text-muted'
                      }`}
                    >
                      {item.kind === 'event' ? '• ' : ''}{item.title}
                    </div>
                  ))}
                  {items.length > 2 && (
                    <div className="text-[10px] text-faint">+{items.length - 2} more</div>
                  )}
                </div>

                {items.length > 0 && (
                  <div className="sm:hidden flex gap-0.5 mt-1">
                    {items.slice(0, 3).map(item => (
                      <span
                        key={item.key}
                        className={`w-1 h-1 rounded-full ${item.kind === 'event' ? 'bg-fg' : 'bg-muted'}`}
                      />
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
