import { useState, useEffect } from 'react'
import useTasks from './hooks/useTasks'
import { toISODate } from './lib/tasks'
import useCalendarEvents from './hooks/useCalendarEvents'
import useEventNotes from './hooks/useEventNotes'
import useEmails from './hooks/useEmails'
import Layout from './components/Layout'
import GreetingHeader from './components/GreetingHeader'
import StatRow from './components/StatRow'
import Timeline from './components/Timeline'
import WeekView from './components/WeekView'
import MonthView from './components/MonthView'
import SearchResults from './components/SearchResults'
import { weekDays, monthGrid } from './lib/dates'
import EmailSection from './components/EmailSection'
import TasksSection from './components/TasksSection'
import SettingsModal from './components/SettingsModal'

const SETTINGS_KEY = 'sentinel.settings.v1'
const defaultSettings = { hideCompleted: false }

export default function App() {
  const {
    tasks,
    addTask,
    updateTask,
    deleteTask,
    deleteSeries,
    toggleReminder,
    toggleComplete,
    toggleSubtask,
    error: taskError,
    clearError: clearTaskError,
  } = useTasks()

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY)
      if (saved) return { ...defaultSettings, ...JSON.parse(saved) }
    } catch (e) {
      // ignore
    }
    return defaultSettings
  })

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch (e) {
      // non-fatal
    }
  }, [settings])

  const [showGreeting, setShowGreeting] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notice, setNotice] = useState(null)

  // Google bounces back here after connecting a mailbox — surface the result,
  // then clean the params out of the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    const err = params.get('connect_error')
    if (!connected && !err) return
    setNotice(
      connected
        ? { kind: 'ok', text: `Connected ${connected}` }
        : { kind: 'err', text: `Couldn't connect that account (${err})` }
    )
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  // Real mail across every connected account, sorted by Claude into reply /
  // read / unsubscribe / junk. Claude only ever sorts; acting is always a click.
  const {
    emails,
    loading: emailsLoading,
    remaining: emailsRemaining,
    error: emailError,
    accountErrors: emailAccountErrors,
    clearError: clearEmailError,
    act: actOnEmail,
  } = useEmails()

  // Real events from every connected Google Calendar, merged onto the timeline.
  // Sentinel always opens on today, in day view; you navigate away deliberately.
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [view, setView] = useState('day')
  const selectedISO = toISODate(selectedDate)

  // Each view fetches exactly the span it shows.
  const week = weekDays(selectedDate)
  const month = monthGrid(selectedDate)
  const rangeStart = view === 'week' ? week[0] : view === 'month' ? month[0] : selectedDate
  const rangeEnd = view === 'week' ? week[6] : view === 'month' ? month[month.length - 1] : selectedDate

  const {
    events,
    loading: calendarLoading,
    error: calendarError,
  } = useCalendarEvents(rangeStart, rangeEnd)

  const dayEvents = events.filter(e => e.date === selectedISO)

  // Sentinel-side prep checklists layered onto calendar blocks.
  const {
    notes: eventNotes,
    addSubtask: addEventSubtask,
    toggleSubtask: toggleEventSubtask,
    removeSubtask: removeEventSubtask,
    toggleDone: toggleEventDone,
    backfillContext,
  } = useEventNotes()

  const [search, setSearch] = useState('')
  const searching = search.trim().length > 0

  // Older notes are missing their event context; fill it in whenever the real
  // event is on screen, so they become searchable without any action from you.
  useEffect(() => {
    if (events.length) backfillContext(events)
  }, [events, backfillContext])

  const reviewAll = () => {
    document.getElementById('working-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Dated tasks belong to their day. A general task (no date) just lives under
  // Today's tasks until it's done.
  const isTodayView = selectedISO === toISODate(new Date())
  const dayTasks = tasks.filter(t => t.date === selectedISO || (!t.date && isTodayView))
  const visibleTasks = settings.hideCompleted
    ? dayTasks.filter(t => !t.completed)
    : dayTasks

  return (
    <Layout onOpenSettings={() => setSettingsOpen(true)}>
      <main className="space-y-6">
        {/* A save that failed should say so, not quietly vanish */}
        {taskError && (
          <div className="card card-border-accent flex items-center justify-between gap-4">
            <p className="text-sm text-fg">
              Couldn't save that task — {taskError}
            </p>
            <button
              onClick={clearTaskError}
              className="text-xs text-faint hover:text-fg transition-colors shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Result of a "connect account" round-trip */}
        {notice && (
          <div className="card flex items-center justify-between gap-4">
            <p className={`text-sm ${notice.kind === 'ok' ? 'text-fg' : 'text-muted'}`}>
              {notice.text}
            </p>
            <button
              onClick={() => setNotice(null)}
              className="text-xs text-faint hover:text-fg transition-colors shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Compact greeting bar */}
        {showGreeting && (
          <GreetingHeader
            onReviewAll={reviewAll}
            onDismiss={() => setShowGreeting(false)}
          />
        )}

        {/* At-a-glance stats for the day you're looking at */}
        <StatRow
          tasks={dayTasks}
          events={dayEvents}
          emails={emails}
          isToday={isTodayView}
        />

        {/* Search everything on record — tasks, annotated blocks, their subtasks */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search your work — e.g. “Champions for Growth”"
            className="input w-full pl-10 pr-16"
          />
          {searching && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint hover:text-fg transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Searching takes over the schedule area; clearing returns you to it. */}
        {searching ? (
          <SearchResults
            tasks={tasks}
            eventNotes={eventNotes}
            query={search}
            onChangeDate={(d) => { setSelectedDate(d); setView('day'); setSearch('') }}
          />
        ) : view === 'day' ? (
          <Timeline
            tasks={visibleTasks}
            events={dayEvents}
            onToggleSubtask={toggleSubtask}
            calendarLoading={calendarLoading}
            calendarError={calendarError}
            eventNotes={eventNotes}
            onAddEventSubtask={addEventSubtask}
            onToggleEventSubtask={toggleEventSubtask}
            onRemoveEventSubtask={removeEventSubtask}
            onToggleEventDone={toggleEventDone}
            selectedDate={selectedDate}
            onChangeDate={setSelectedDate}
            defaultDate={selectedISO}
            onAddTask={addTask}
            onToggleComplete={toggleComplete}
            view={view}
            onChangeView={setView}
          />
        ) : view === 'week' ? (
          <WeekView
            tasks={tasks}
            events={events}
            selectedDate={selectedDate}
            onChangeDate={setSelectedDate}
            onAddTask={addTask}
            onToggleComplete={toggleComplete}
            view={view}
            onChangeView={setView}
            calendarLoading={calendarLoading}
            calendarError={calendarError}
          />
        ) : (
          <MonthView
            tasks={tasks}
            events={events}
            selectedDate={selectedDate}
            onChangeDate={setSelectedDate}
            view={view}
            onChangeView={setView}
            calendarLoading={calendarLoading}
            calendarError={calendarError}
          />
        )}

        {/* Two-column working area */}
        <div id="working-area" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-20">
          <TasksSection
            tasks={visibleTasks}
            onToggleReminder={toggleReminder}
            onToggleComplete={toggleComplete}
            onAdd={addTask}
            onUpdate={updateTask}
            onDelete={deleteTask}
            onDeleteSeries={deleteSeries}
            defaultDate={selectedISO}
          />
          <EmailSection
            emails={emails}
            loading={emailsLoading}
            remaining={emailsRemaining}
            error={emailError}
            accountErrors={emailAccountErrors}
            onAct={actOnEmail}
            onClearError={clearEmailError}
          />
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={setSettings}
      />
    </Layout>
  )
}
