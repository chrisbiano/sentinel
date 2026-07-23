/* Sentyra service worker.
 *
 * Two jobs: make the app installable (an active SW is required for the iOS
 * "Add to Home Screen" → notifications path), and receive push messages so
 * reminders reach the phone even when Sentyra isn't open.
 *
 * Intentionally cache-free for now — Sentyra is live, personal, and always
 * online; a stale-cache SW would just serve old bundles (a bug we already hit
 * once with Safari). If offline support is wanted later, add it deliberately. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// A reminder arrives as a push. Show it; tapping it opens Sentyra to the task.
self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = { body: event.data && event.data.text() } }

  const title = payload.title || 'Sentyra'
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
  // A task reminder's tag is "task-<id>", so we can jump straight to that task
  // without the payload carrying anything extra. If a window is already open we
  // focus it and tell the app which task to surface; otherwise we open a deep link.
  const tag = event.notification.tag || ''
  const taskId = tag.startsWith('task-') ? tag.slice(5) : null
  const url = taskId ? `/?task=${taskId}` : (event.notification.data?.url || '/')
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const client = windows.find(c => 'focus' in c)
    if (client) {
      await client.focus()
      // A still-visible window is alive — just tell it which task to surface, no
      // reload flash. But a backgrounded/suspended iOS PWA webview resumes BLACK:
      // WebKit runs the JS again yet never repaints. Navigating that window forces
      // a real render (and carries the ?task= deep-link). Fall back to a message
      // if navigate() isn't available or gets rejected (e.g. uncontrolled client).
      if (client.visibilityState === 'visible') {
        if (taskId) client.postMessage({ type: 'open-task', taskId })
        return
      }
      try {
        if ('navigate' in client) { await client.navigate(url); return }
      } catch { /* fall through to a message */ }
      if (taskId) client.postMessage({ type: 'open-task', taskId })
      return
    }
    return self.clients.openWindow(url)
  })())
})
