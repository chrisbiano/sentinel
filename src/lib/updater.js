/* Auto-update for the installed PWA.
 *
 * iOS home-screen apps do a *warm resume* when you switch back to them — they
 * keep running the already-loaded JS and never re-fetch index.html, so a new
 * deploy isn't picked up just by reopening the app. (The service worker is
 * cache-free, so it isn't the cause; this is WebKit's own page cache.)
 *
 * The fix: the running app knows its own build id (__BUILD_ID__, baked in at
 * build time). When the app is foregrounded, it fetches /version.json fresh
 * from the network — an explicit fetch() bypasses the stale document cache —
 * and if the server is on a newer build, it forces a real reload(). A real
 * reload honors the HTML's `must-revalidate`, so it pulls the new index.html
 * and the new bundle. No more delete/re-add-to-home-screen dance. */

const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

let reloading = false

async function serverBuild() {
  try {
    // Cache-buster + no-store so we always hit the network, never the PWA cache.
    const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const j = await res.json()
    return j?.build || null
  } catch {
    return null // offline or blocked — never let the check throw
  }
}

async function checkForUpdate() {
  if (reloading) return
  const server = await serverBuild()
  if (!server || server === BUILD_ID) return

  // Guard against a reload loop: if a reload didn't actually land the new build
  // (e.g. the cache still served the old HTML), don't keep reloading for the
  // same target. sessionStorage persists across reload() but clears on a full
  // app quit, so a later cold start gets a fresh attempt.
  if (sessionStorage.getItem('sentinel_update_to') === server) return
  sessionStorage.setItem('sentinel_update_to', server)

  reloading = true
  window.location.reload()
}

export function startUpdater() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
  window.addEventListener('focus', checkForUpdate)
  // Also poll gently while the app stays open, and once shortly after launch.
  setInterval(checkForUpdate, 5 * 60 * 1000)
  setTimeout(checkForUpdate, 3000)
}
