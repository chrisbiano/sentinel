/* Sentinel service worker.
 *
 * Two jobs: make the app installable (an active SW is required for the iOS
 * "Add to Home Screen" → notifications path), and receive push messages so
 * reminders reach the phone even when Sentinel isn't open.
 *
 * Intentionally cache-free for now — Sentinel is live, personal, and always
 * online; a stale-cache SW would just serve old bundles (a bug we already hit
 * once with Safari). If offline support is wanted later, add it deliberately. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// A reminder arrives as a push. Show it; tapping it opens Sentinel to the task.
self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = { body: event.data && event.data.text() } }

  const title = payload.title || 'Sentinel'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag,                 // same tag replaces, not stacks (e.g. one med reminder)
      renotify: Boolean(payload.tag),   // but still buzz when it re-fires
      data: { url: payload.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
