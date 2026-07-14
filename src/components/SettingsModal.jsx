import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${
        checked ? 'bg-accent' : 'bg-surface2 border border-line2'
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full transition-all ${
          checked ? 'left-[1.125rem] bg-accent-fg' : 'left-0.5 bg-muted'
        }`}
      />
    </button>
  )
}

const integrations = [
  { name: 'Google Calendar', status: 'Not connected', note: 'Pulls events onto your timeline' },
  { name: 'Gmail', status: 'Not connected', note: 'Surfaces emails needing a reply' },
  { name: 'Structured', status: 'No public API', note: 'Move tasks over manually' },
]

export default function SettingsModal({ open, onClose, settings, onChange }) {
  const [email, setEmail] = useState(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !isSupabaseConfigured) return
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null))
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md mt-16 sm:mt-0 bg-surface border border-line2 rounded-2xl shadow-xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-base font-medium text-fg">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-fg hover:bg-surface2 transition-colors"
          >
            <XIcon />
          </button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* Preferences */}
          <div>
            <h3 className="text-xs font-medium text-faint uppercase tracking-wider mb-3">Preferences</h3>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-fg">Hide completed tasks</p>
                <p className="text-xs text-faint mt-0.5">Keep the schedule and list focused on what's left</p>
              </div>
              <Toggle
                checked={settings.hideCompleted}
                onChange={() => onChange({ ...settings, hideCompleted: !settings.hideCompleted })}
              />
            </div>
          </div>

          {/* Account */}
          {isSupabaseConfigured && (
            <div>
              <h3 className="text-xs font-medium text-faint uppercase tracking-wider mb-3">Account</h3>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-fg truncate">{email || 'Signed in'}</p>
                  <p className="text-xs text-faint mt-0.5">Google account</p>
                </div>
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="px-3 py-1.5 text-sm rounded-lg border border-line2 text-muted hover:text-fg hover:bg-surface2 transition-colors shrink-0"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}

          {/* Integrations */}
          <div>
            <h3 className="text-xs font-medium text-faint uppercase tracking-wider mb-3">Integrations</h3>
            <div className="space-y-2">
              {integrations.map(i => (
                <div key={i.name} className="flex items-center justify-between gap-4 py-1">
                  <div className="min-w-0">
                    <p className="text-sm text-fg">{i.name}</p>
                    <p className="text-xs text-faint mt-0.5">{i.note}</p>
                  </div>
                  <span className="text-xs text-muted border border-line px-2.5 py-1 rounded-full shrink-0">
                    {i.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-line text-xs text-faint">
          Sentinel · local prototype — preferences saved to this browser
        </div>
      </div>
    </div>
  )
}
