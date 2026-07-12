import { useState, useEffect } from 'react'
import Layout from './components/Layout'
import GreetingHeader from './components/GreetingHeader'
import StatRow from './components/StatRow'
import Timeline from './components/Timeline'
import EmailSection from './components/EmailSection'
import TasksSection from './components/TasksSection'
import UnsubscribeSection from './components/UnsubscribeSection'
import SettingsModal from './components/SettingsModal'

const TASKS_KEY = 'sentinel.tasks.v1'
const SETTINGS_KEY = 'sentinel.settings.v1'
const defaultSettings = { hideCompleted: false }

const defaultTasks = [
  {
    id: 1,
    title: 'Client call with RSM',
    time: '09:00 AM',
    duration: 60,
    hasReminder: true,
    isUrgent: false,
    completed: false,
    subtasks: []
  },
  {
    id: 2,
    title: 'Edit video for Champions for Growth',
    time: '02:00 PM',
    duration: 120,
    hasReminder: false,
    isUrgent: false,
    completed: false,
    subtasks: [
      { id: 's1', title: 'Pull selects', done: true },
      { id: 's2', title: 'Rough cut', done: false },
      { id: 's3', title: 'Color + export', done: false },
    ]
  },
]

export default function App() {
  const [tasks, setTasks] = useState(() => {
    try {
      const saved = localStorage.getItem(TASKS_KEY)
      if (saved) return JSON.parse(saved)
    } catch (e) {
      // ignore corrupt storage, fall back to defaults
    }
    return defaultTasks
  })

  // Persist tasks so they survive refreshes (no backend yet).
  useEffect(() => {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks))
    } catch (e) {
      // storage full / unavailable — non-fatal
    }
  }, [tasks])

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

  // Calendar events — populated from Google Calendar once wired up. The
  // Timeline already merges these with tasks; empty until the integration lands.
  const [events] = useState([])

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

  const toggleTaskReminder = (id) => {
    setTasks(prev => prev.map(task =>
      task.id === id ? { ...task, hasReminder: !task.hasReminder } : task
    ))
  }

  const toggleTaskComplete = (id) => {
    setTasks(prev => prev.map(task =>
      task.id === id ? { ...task, completed: !task.completed } : task
    ))
  }

  const addTask = (data) => {
    setTasks(prev => [
      ...prev,
      { id: Date.now(), isUrgent: false, completed: false, subtasks: [], ...data },
    ])
  }

  const toggleSubtask = (taskId, subId) => {
    setTasks(prev => prev.map(task =>
      task.id === taskId
        ? {
            ...task,
            subtasks: (task.subtasks || []).map(s =>
              s.id === subId ? { ...s, done: !s.done } : s
            ),
          }
        : task
    ))
  }

  const updateTask = (id, data) => {
    setTasks(prev => prev.map(task =>
      task.id === id ? { ...task, ...data } : task
    ))
  }

  const deleteTask = (id) => {
    setTasks(prev => prev.filter(task => task.id !== id))
  }

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

  const visibleTasks = settings.hideCompleted
    ? tasks.filter(t => !t.completed)
    : tasks

  return (
    <Layout onOpenSettings={() => setSettingsOpen(true)}>
      <main className="space-y-6">
        {/* Compact greeting bar */}
        {showGreeting && (
          <GreetingHeader
            onReviewAll={reviewAll}
            onDismiss={() => setShowGreeting(false)}
          />
        )}

        {/* At-a-glance stats */}
        <StatRow tasks={tasks} emails={emails} />

        {/* Time-blocked day (Structured-style) */}
        <Timeline tasks={visibleTasks} events={events} onToggleSubtask={toggleSubtask} />

        {/* Two-column working area */}
        <div id="working-area" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-20">
          <TasksSection
            tasks={visibleTasks}
            onToggleReminder={toggleTaskReminder}
            onToggleComplete={toggleTaskComplete}
            onAdd={addTask}
            onUpdate={updateTask}
            onDelete={deleteTask}
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
