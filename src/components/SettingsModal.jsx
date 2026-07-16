import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { startGoogleConnect, isConnectConfigured } from '../lib/connect'
import useConnectedAccounts from '../hooks/useConnectedAccounts'

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

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

/* One connected mailbox, plus the note that tells Claude what it's for.
 *
 * This note is the difference between a venue's booking inquiry landing in
 * "Reply" and landing in "Junk" — without it, Claude only sees an email from a
 * stranger. Once saved it collapses to a one-line gist with an Edit button, so
 * a described mailbox reads as done rather than as an open box you're unsure
 * about. The empty state nags on purpose — a missing note is a confidently
 * wrong verdict later. */
function AccountRow({ account, onSetPurpose, onDisconnect }) {
  const saved = account.purpose ?? ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(saved)
  const [saving, setSaving] = useState(false)

  const dirty = draft.trim() !== saved.trim()

  const open = () => { setDraft(saved); setEditing(true) }
  const cancel = () => { setDraft(saved); setEditing(false) }

  const save = async () => {
    if (!dirty) { setEditing(false); return }
    setSaving(true)
    const res = await onSetPurpose(account.id, draft)
    setSaving(false)
    // Stay open on failure so the text isn't lost; collapse only on success.
    if (res?.ok !== false) setEditing(false)
  }

  // One-line gist for the collapsed view — cut on a word boundary.
  const gist = saved.trim().length > 64
    ? saved.trim().slice(0, 64).replace(/\s+\S*$/, '') + '…'
    : saved.trim()

  return (
    <div className="py-2 border-b border-line last:border-0">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-fg truncate">{account.email}</p>
          <p className="text-xs text-faint mt-0.5 capitalize">
            {account.provider} · {account.status}
          </p>
        </div>
        <button
          onClick={() => onDisconnect(account.id)}
          className="text-xs text-faint hover:text-fg border border-line px-2.5 py-1 rounded-full shrink-0 transition-colors"
        >
          Disconnect
        </button>
      </div>

      {editing ? (
        <div className="mt-2">
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={3}
            placeholder="What's this mailbox for? e.g. “My band Lost Saints — booking inquiries from venues and promoters, plus press. Anything about a date or a show matters.”"
            className="input w-full text-xs resize-none"
          />
          <div className="flex items-center justify-end gap-2 mt-1.5">
            <button
              onClick={cancel}
              className="text-xs text-faint hover:text-fg transition-colors px-2 py-1"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="text-xs px-3 py-1 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : saved.trim() ? (
        <div className="flex items-center justify-between gap-3 mt-2">
          <p className="text-xs text-muted italic truncate">“{gist}”</p>
          <button
            onClick={open}
            className="text-xs text-faint hover:text-fg border border-line px-2.5 py-1 rounded-full shrink-0 transition-colors"
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 mt-2">
          <p className="text-xs text-muted min-w-0">
            No context yet — Claude will guess, and guess wrong on the mail you care about.
          </p>
          <button
            onClick={open}
            className="text-xs px-2.5 py-1 rounded-lg bg-accent text-accent-fg font-medium hover:opacity-90 transition-opacity shrink-0"
          >
            Add context
          </button>
        </div>
      )}
    </div>
  )
}

export default function SettingsModal({ open, onClose, settings, onChange }) {
  const [email, setEmail] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const { accounts, loading: accountsLoading, disconnect, setPurpose } = useConnectedAccounts()

  const connect = async () => {
    setConnecting(true)
    try {
      await startGoogleConnect()
    } catch (e) {
      console.error('Connect failed:', e)
      setConnecting(false)
    }
  }

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
              <h3 className="text-xs font-medium text-faint uppercase tracking-wider mb-3">Signed in as</h3>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-fg truncate">{email || 'Signed in'}</p>
                  <p className="text-xs text-faint mt-0.5">
                    Your Sentinel login — this alone doesn't give access to any mail or calendar
                  </p>
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

          {/* Connected mailboxes */}
          {isConnectConfigured && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-medium text-faint uppercase tracking-wider">
                  Connected accounts
                </h3>
                <button
                  onClick={connect}
                  disabled={connecting}
                  className="flex items-center gap-1 text-xs font-medium text-muted hover:text-fg border border-line2 rounded-lg px-2.5 py-1 transition-colors disabled:opacity-50"
                >
                  <PlusIcon /> {connecting ? 'Opening…' : 'Connect account'}
                </button>
              </div>
              <p className="text-xs text-faint mb-3">
                Mailboxes Sentinel reads. Tell each one what it's for — that's what
                Claude uses to tell a real ask from noise, and it reads them differently.
              </p>

              {accountsLoading ? (
                <p className="text-xs text-faint">Loading…</p>
              ) : accounts.length === 0 ? (
                <p className="text-xs text-faint">
                  None yet. Start by connecting <span className="text-muted">{email || 'the account you signed in with'}</span> — granting
                  access is a separate step from signing in — then add your other accounts.
                </p>
              ) : (
                <div>
                  {accounts.map(a => (
                    <AccountRow
                      key={a.id}
                      account={a}
                      onSetPurpose={setPurpose}
                      onDisconnect={disconnect}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line text-xs text-faint">
          Sentinel · calendar read-only — your tokens never touch the browser
        </div>
      </div>
    </div>
  )
}
