// Sentinel — deliver a Web Push notification to a user's devices.
//
// Deploy with "Verify JWT" ON. Needs secrets:
//   VAPID_PRIVATE_KEY  (from .vapid.local.txt)
//   VAPID_SUBJECT      (e.g. mailto:chris@fastrosecreative.com)
// and the public key, which the frontend already holds as VITE_VAPID_PUBLIC_KEY
// and passes in so both halves provably match.
//
// Phase 2 uses this for a "ping my phone" test. Phase 3's scheduler will reuse
// the same send path with reminder payloads.
//
// Dead subscriptions (expired, or the user removed the app) come back 404/410 —
// we delete those so the list stays clean and we don't retry forever.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:sentinel@example.com'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })

// Shared so Phase 3's scheduler can push to a user without re-implementing it.
export async function sendToUser(admin: any, userId: string, payload: unknown, vapidPublicKey: string) {
  webpush.setVapidDetails(VAPID_SUBJECT, vapidPublicKey, VAPID_PRIVATE_KEY!)

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  let sent = 0
  const deadIds: string[] = []
  const body = JSON.stringify(payload)

  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      )
      sent++
    } catch (e: any) {
      // 404 gone, 410 expired — this device is no longer reachable.
      if (e?.statusCode === 404 || e?.statusCode === 410) deadIds.push(s.id)
      else console.error('push send error:', e?.statusCode, e?.body || e?.message)
    }
  }

  if (deadIds.length) {
    await admin.from('push_subscriptions').delete().in('id', deadIds)
  }
  return { devices: (subs ?? []).length, sent, removed: deadIds.length }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!)
  const { data: u, error: uErr } = await admin.auth.getUser(jwt)
  if (uErr || !u?.user) return json({ error: 'unauthorized' }, 401)

  if (!VAPID_PRIVATE_KEY) {
    return json({ error: 'VAPID_PRIVATE_KEY is not set on this function' }, 500)
  }

  let body: any = {}
  try { body = await req.json() } catch { /* none */ }
  const { mode, vapidPublicKey } = body
  if (!vapidPublicKey) {
    return json({ error: 'vapidPublicKey is required (frontend passes VITE_VAPID_PUBLIC_KEY)' }, 400)
  }

  // Phase 2: a test ping to the caller's own devices.
  if (mode === 'test') {
    const result = await sendToUser(admin, u.user.id, {
      title: 'Sentinel',
      body: 'Notifications are on. This is your test ping. 🎯',
      tag: 'sentinel-test',
      url: '/',
    }, vapidPublicKey)

    if (result.devices === 0) {
      return json({ error: 'No devices are subscribed on this account yet.' }, 400)
    }
    return json({ ok: true, ...result })
  }

  return json({ error: 'Unknown mode' }, 400)
})
