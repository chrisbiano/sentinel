import { useState, useEffect } from 'react'
import useTasks from './hooks/useTasks'
import useUserPrefs from './hooks/useUserPrefs'
import { toISODate } from './lib/tasks'
import { supabase } from './lib/supabase'
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
import AssistantLauncher from './components/AssistantLauncher'
import MorningBriefCard from './components/MorningBriefCard'
import UndoToast from './components/UndoToast'
import useMorningBrief from './hooks/useMorningBrief'

const SETTINGS_KEY = 'sentinel.settings.v1'
const defaultSettings = { hideCompleted: false }

export default function App() {
  const {
    tasks,
    addTask,
    updateTask,
    deleteTask,
    deleteSeries,
    duplicateTask,
    toggleReminder,
    snoozeTask,
    unsnoozeTask,
    toggleComplete,
    toggleSubtask,
    error: taskError,
    clearError: clearTaskError,
  } = useTasks()

  // Captures the browser timezone (so the morning brief lands at 7am local) and
  // holds the brief on/off toggle.
  const { morningBrief, setMorningBrief, briefTime, setBriefTime } = useUserPrefs()

  // The morning brief lives as a card at the top of the dashboard until dismissed.
  const { brief, loading: briefLoading, show: showBrief, dismiss: dismissBrief } =
    useMorningBrief({ enabled: morningBrief, briefTime })

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
    // Reopen Settings on return — a fresh account needs its purpose note and
    // signature check, and both live here. Landing on the bare dashboard would
    // hide that the note even exists.
    setSettingsOpen(true)
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
    dismiss: dismissEmail,
    reclassify: reclassifyEmail,
    toggleFlag: toggleEmailFlag,
    markTaskAdded: markEmailTaskAdded,
    undoable: emailUndoable,
    undo: undoEmail,
    dismissUndo: dismissEmailUndo,
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
    setSubtasks: setEventSubtasks,
    toggleDone: toggleEventDone,
    backfillContext,
  } = useEventNotes()

  const [search, setSearch] = useState('')
  const searching = search.trim().length > 0

  // Tapping a reminder deep-links to its task. The service worker sends the id
  // (via ?task= on a cold open, or a postMessage when a window's already up); we
  // jump to that task's day and flash it. `tasks` may still be loading, so the
  // resolve effect below re-runs when it arrives.
  const [highlightTaskId, setHighlightTaskId] = useState(null)
  const [pendingTaskId, setPendingTaskId] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('task') } catch { return null }
  })

  useEffect(() => {
    const onMsg = (e) => {
      if (e.data?.type === 'open-task' && e.data.taskId) setPendingTaskId(String(e.data.taskId))
    }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg)
  }, [])

  // Older notes are missing their event context; fill it in whenever the real
  // event is on screen, so they become searchable without any action from you.
  useEffect(() => {
    if (events.length) backfillContext(events)
  }, [events, backfillContext])

  const reviewAll = () => {
    document.getElementById('working-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Quick add: send a natural-language note to Claude and get back a task the
  // form can pre-fill. Timezone-relative words ("tomorrow") resolve against the
  // browser's local date, passed along. Returns a TaskForm-shaped object.
  const parseTask = async (text) => {
    const now = new Date()
    const { data, error } = await supabase.functions.invoke('parse-task', {
      body: {
        text,
        today: toISODate(now),
        weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
        nowTime: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      },
    })
    if (error || data?.error) {
      let msg = data?.error
      if (error) {
        try { const b = await error.context?.json?.(); msg = b?.message || b?.error || error.message } catch { msg = error.message }
      }
      throw new Error(msg || 'Could not read that')
    }
    const p = data.task
    return {
      title: p.title,
      date: p.date,       // YYYY-MM-DD | null
      time: p.time,       // "10:00 AM" | null
      duration: p.durationMin,
      hasReminder: p.reminder,
      subtasks: (p.subtasks || []).map(t => ({ id: Math.random().toString(36).slice(2, 9), title: t, done: false })),
    }
  }

  // Resolve a reminder deep-link once the task is known: focus its day, scroll to
  // the task list, and flash the task for a few seconds.
  useEffect(() => {
    if (!pendingTaskId) return
    const t = tasks.find(x => String(x.id) === String(pendingTaskId))
    if (!t) return   // tasks still loading — this re-runs when they land
    if (t.date) { setSelectedDate(new Date(`${t.date}T00:00:00`)); setView('day') }
    setSearch('')
    setHighlightTaskId(t.id)
    setPendingTaskId(null)
    try { window.history.replaceState({}, '', window.location.pathname) } catch { /* ignore */ }
    // Timed tasks are on the schedule now, untimed ones in the list — jump to
    // wherever this one actually lives.
    setTimeout(() => scrollToSection(t.time ? 'schedule-section' : 'tasks-section'), 80)
    const clear = setTimeout(() => setHighlightTaskId(null), 3000)
    return () => clearTimeout(clear)
  }, [pendingTaskId, tasks])

  // "This needs an answer, but not right now." Drops a dateless task that rides
  // Today forward until it's checked off — the don't-forget-to-reply net. Marks
  // the email so its + Task button greys out and can't make a duplicate.
  const addEmailToTasks = (email) => {
    if (email.task_created) return
    const who = email.sender || email.sender_email || 'someone'
    const subject = email.subject || '(no subject)'
    addTask({ title: `Reply: ${who} — ${subject}`, date: null })
    markEmailTaskAdded(email)
  }

  // Dated tasks belong to their day. A general task (no date) just lives under
  // Today's tasks until it's done.
  const isTodayView = selectedISO === toISODate(new Date())
  const dayTasks = tasks.filter(t => t.date === selectedISO || (!t.date && isTodayView))
  const visibleTasks = settings.hideCompleted
    ? dayTasks.filter(t => !t.completed)
    : dayTasks
  // Timed tasks live on the schedule only (they have a slot there); the task list
  // is for the untimed "whenever" to-dos. Keeps the two from doubling up.
  const untimedTasks = visibleTasks.filter(t => !t.time)

  return (
    <Layout onOpenSettings={() => setSettingsOpen(true)}>
      <main className="space-y-6">
        {/* Morning brief — pinned at the very top until dismissed. */}
        {showBrief && (
          <MorningBriefCard brief={brief} loading={briefLoading} onDismiss={dismissBrief} />
        )}

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
          onTasksClick={() => scrollToSection('tasks-section')}
          onEmailsClick={() => scrollToSection('emails-section')}
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
          <div id="schedule-section" className="scroll-mt-20">
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
            onSetEventSubtasks={setEventSubtasks}
            onToggleEventDone={toggleEventDone}
            onUpdateTask={updateTask}
            onToggleReminder={toggleReminder}
            onSnooze={snoozeTask}
            onUnsnooze={unsnoozeTask}
            highlightId={highlightTaskId}
            selectedDate={selectedDate}
            onChangeDate={setSelectedDate}
            defaultDate={selectedISO}
            onAddTask={addTask}
            onToggleComplete={toggleComplete}
            view={view}
            onChangeView={setView}
          />
          </div>
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

        {/* Two-column working area. Each side is its own scroll anchor so the
            stat tiles up top can jump straight to it. */}
        <div id="working-area" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-20">
          <div id="tasks-section" className="scroll-mt-20">
            <TasksSection
              tasks={untimedTasks}
              onToggleReminder={toggleReminder}
              onSnooze={snoozeTask}
              onUnsnooze={unsnoozeTask}
              onToggleComplete={toggleComplete}
              onAdd={addTask}
              onUpdate={updateTask}
              onDelete={deleteTask}
              onDeleteSeries={deleteSeries}
              onDuplicate={duplicateTask}
              highlightId={highlightTaskId}
              defaultDate={selectedISO}
            />
          </div>
          <div id="emails-section" className="scroll-mt-20">
            <EmailSection
              emails={emails}
              loading={emailsLoading}
              remaining={emailsRemaining}
              error={emailError}
              accountErrors={emailAccountErrors}
              onAct={actOnEmail}
              onDismiss={dismissEmail}
              onReclassify={reclassifyEmail}
              onFlag={toggleEmailFlag}
              onAddToTasks={addEmailToTasks}
              onClearError={clearEmailError}
            />
          </div>
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={setSettings}
        morningBrief={morningBrief}
        onMorningBriefChange={setMorningBrief}
        briefTime={briefTime}
        onBriefTimeChange={setBriefTime}
      />

      {/* Floating AI quick-add — bottom-left, always in reach. */}
      <AssistantLauncher
        onParseTask={parseTask}
        onAdd={addTask}
        defaultDate={selectedISO}
      />

      <UndoToast
        undoable={emailUndoable}
        onUndo={undoEmail}
        onDismiss={dismissEmailUndo}
      />
    </Layout>
  )
}
