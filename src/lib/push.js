import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export const isPushConfigured = Boolean(VAPID_PUBLIC_KEY)

// Web Push needs the VAPID public key as a Uint8Array, not the base64url string.
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// Is the app running as an installed PWA (vs a browser tab)? On iOS this is the
// gate — Apple only delivers push to home-screen installs, so a Safari tab
// literally can't subscribe, and we need to say so rather than fail cryptically.
export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

// What's blocking notifications, if anything — so the UI can guide instead of
// just greying a button out.
export function pushStatus() {
  if (!isPushConfigured) return 'unconfigured'
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!hasApi) {
    // iOS in a plain Safari tab has no PushManager until installed.
    if (isIOS() && !isStandalone()) return 'ios-needs-install'
    return 'unsupported'
  }
  if (isIOS() && !isStandalone()) return 'ios-needs-install'
  return 'ready'
}

// Reject after `ms` instead of hanging forever. iOS is the reason this exists:
// on a freshly installed PWA, `serviceWorker.ready` and the permission prompt can
// stay pending on the first session until the app is closed and reopened — which
// left the "Turn on" button stuck on a grey "…" with no way out.
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ])
}

const REOPEN_HINT =
  'Notifications aren’t ready yet — Sentyra is still finishing setup after being added to your Home Screen. Fully close the app (swipe it away in the app switcher) and reopen it, then try again.'

// Get an active service-worker registration we can subscribe against. On a fresh
// install the `load`-time registration may not have run in this context yet, so
// (re)register first — it's a no-op if already registered — then wait for ready,
// but never longer than the timeout.
async function readyRegistration(ms = 8000) {
  try { await navigator.serviceWorker.register('/sw.js') } catch { /* ready may still resolve */ }
  return withTimeout(navigator.serviceWorker.ready, ms, REOPEN_HINT)
}

export async function currentSubscription() {
  if (!('serviceWorker' in navigator)) return null
  // Used on mount to show on/off state — must never hang, so on timeout just
  // report "no subscription" rather than freezing the settings panel.
  try {
    const reg = await withTimeout(navigator.serviceWorker.ready, 6000, 'sw-not-ready')
    return reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

// Ask permission, subscribe this device, and save it. Returns the subscription
// or throws with a message the UI can show. Every await is bounded so the caller
// can always leave the busy state.
export async function enablePush() {
  const permission = await withTimeout(
    Notification.requestPermission(),
    30000,
    'The notification permission prompt didn’t respond. Fully close Sentyra and reopen it, then try again.',
  )
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for Sentyra in your settings.'
        : 'Notification permission was dismissed.',
    )
  }

  const reg = await readyRegistration()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await withTimeout(
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }),
      15000,
      'Couldn’t register this device for notifications. Fully close Sentyra and reopen it, then try again.',
    )
  }

  const { data: { user } } = await withTimeout(
    supabase.auth.getUser(),
    10000,
    'Couldn’t confirm you’re signed in (network may be slow). Try again in a moment.',
  )
  if (!user) throw new Error('Not signed in')

  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint: j.endpoint,
      p256dh: j.keys.p256dh,
      auth: j.keys.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: 'user_id,endpoint' },
  )
  if (error) throw new Error(`Couldn't save this device: ${error.message}`)
  return sub
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => {})
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
}

// Ask the server to push a test notification to this account's devices.
export async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke('push-send', {
    body: { mode: 'test', vapidPublicKey: VAPID_PUBLIC_KEY },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}
