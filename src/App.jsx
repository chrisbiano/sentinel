import { useState, useEffect } from 'react'
import useTasks from './hooks/useTasks'
import { toISODate } from './lib/tasks'
import useCalendarEvents from './hooks/useCalendarEvents'
import useEventNotes from './hooks/useEventNotes'
import Layout from './components/Layout'
import GreetingHeader from './components/GreetingHeader'
import StatRow from './components/StatRow'
import Timeline from './components/Timeline'
import WeekView from './components/WeekView'
import MonthView from './components/MonthView'
import { weekDays, monthGrid } from './lib/dates'
import EmailSection from './components/EmailSection'
import TasksSection from './components/TasksSection'
import UnsubscribeSection from './components/UnsubscribeSection'
import SettingsModal from './components/SettingsModal'

const SETTINGS_KEY = 'sentinel.settings.v1'
const defaultSettings = { hideCompleted: false }

export default function App() {
  const {
    tasks,
    addTask,
    updateTask,
    deleteTask,
    toggleReminder,
    toggleComplete,
    toggleSubtask,
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

  const [emails, setEmails] = useState([
    {
      id: 1,
      from: 'Sarah Chen',
      sender: 'sarah@rsm.com',
      subject: 'Project timeline question',
      preview: 'Can we discuss the delivery timeline for Q3 deliverables?',
      needsReply: true,
      flagged: true,
      unread: true,
      timestamp: '2 hours ago'
    },
    {
      id: 2,
      from: 'You',
      sender: 'chris@fastrosecreative.com',
      subject: 'Follow up on proposal',
      preview: 'Marked for follow up - waiting on client feedback',
      needsReply: true,
      flagged: false,
      unread: false,
      timestamp: '4 hours ago'
    },
  ])

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
  } = useEventNotes()

  const [unsubscribeSuggestions, setUnsubscribeSuggestions] = useState([
    {
      id: 1,
      from: 'Weekly Newsletter',
      sender: 'newsletter@example.com',
      reason: 'Recurring newsletter, 0 opens in 60 days',
      opens: 0,
      status: 'pending'
    },
  ])

  const approveUnsubscribe = (id) => {
    setUnsubscribeSuggestions(
      unsubscribeSuggestions.map(item =>
        item.id === id ? { ...item, status: 'approved' } : item
      )
    )
  }

  const rejectUnsubscribe = (id) => {
    setUnsubscribeSuggestions(
      unsubscribeSuggestions.map(item =>
        item.id === id ? { ...item, status: 'rejected' } : item
      )
    )
  }

  const markReplied = (id) => {
    setEmails(prev => prev.map(email =>
      email.id === id ? { ...email, needsReply: false, unread: false } : email
    ))
  }

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

        {/* At-a-glance stats */}
        <StatRow tasks={tasks} emails={emails} />

        {/* Time-blocked day, or the whole week for planning ahead */}
        {view === 'day' ? (
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
            selectedDate={selectedDate}
            onChangeDate={setSelectedDate}
            defaultDate={selectedISO}
            onAddTask={addTask}
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
            defaultDate={selectedISO}
          />
          <EmailSection emails={emails} onReply={markReplied} />
        </div>


        {/* Secondary: unsubscribe suggestions */}
        <UnsubscribeSection
          suggestions={unsubscribeSuggestions}
          onApprove={approveUnsubscribe}
          onReject={rejectUnsubscribe}
        />
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
