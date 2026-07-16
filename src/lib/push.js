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

export async function currentSubscription() {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

// Ask permission, subscribe this device, and save it. Returns the subscription
// or throws with a message the UI can show.
export async function enablePush() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for Sentinel in your settings.'
        : 'Notification permission was dismissed.',
    )
  }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const { data: { user } } = await supabase.auth.getUser()
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
