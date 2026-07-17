// Sentinel — fetch calendar events across all connected Google accounts.
// Pulls from every calendar the account can see (not just "primary"), skipping
// ones hidden in the Google Calendar UI.
// Deploy with "Verify JWT" ON: the app calls this with the user's login token.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

// supabase-js sends x-client-info/apikey on invoke — all of them must be
// allow-listed or the browser's preflight blocks the request.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Google access tokens last ~1h; mint a fresh one from the refresh token when needed.
async function freshAccessToken(admin, account) {
  const { data: tok } = await admin
    .from('account_tokens').select('*').eq('account_id', account.id).single()
  if (!tok) return null

  const stillValid = tok.access_token && tok.expires_at &&
    new Date(tok.expires_at).getTime() > Date.now() + 60_000
  if (stillValid) return tok.access_token

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tok.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const j = await res.json()
  if (!res.ok || !j.access_token) {
    await admin.from('connected_accounts').update({ status: 'error' }).eq('id', account.id)
    return null
  }
  await admin.from('account_tokens').update({
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('account_id', account.id)
  return j.access_token
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
  const { data: u, error: uErr } = await admin.auth.getUser(jwt)
  if (uErr || !u?.user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  let body = {}
  try { body = await req.json() } catch { /* no body */ }
  const timeMin = body.timeMin || new Date().toISOString()
  const timeMax = body.timeMax || new Date(Date.now() + 86_400_000).toISOString()

  const { data: accounts } = await admin
    .from('connected_accounts')
    .select('id, email')
    .eq('user_id', u.user.id)
    .eq('provider', 'google')

  const events = []
  for (const acct of accounts ?? []) {
    const token = await freshAccessToken(admin, acct)
    if (!token) continue
    const auth = { Authorization: `Bearer ${token}` }

    // Every calendar this account can read — "Blocks", "Personal", shared ones, etc.
    const calRes = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader',
      { headers: auth },
    )
    if (!calRes.ok) continue
    const calJson = await calRes.json()
    // `selected: false` = hidden in the Google Calendar UI, so skip it.
    const calendars = (calJson.items ?? []).filter(c => c.selected !== false)

    for (const cal of calendars) {
      const params = new URLSearchParams({
        timeMin, timeMax,
        singleEvents: 'true',   // expand recurring events
        orderBy: 'startTime',
        maxResults: '50',
      })
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
        { headers: auth },
      )
      if (!r.ok) continue
      const j = await r.json()

      for (const e of j.items ?? []) {
        if (e.status === 'cancelled') continue
        events.push({
          // Keyed by the account's EMAIL, not its internal id — email survives a
          // disconnect/reconnect, so Sentinel-side subtasks stay attached instead
          // of being orphaned when the account id is regenerated.
          id: `${acct.email}:${cal.id}:${e.id}`,
          title: e.summary || '(no title)',
          start: e.start?.dateTime || e.start?.date || null,
          end: e.end?.dateTime || e.end?.date || null,
          allDay: Boolean(e.start?.date && !e.start?.dateTime),
          account: acct.email,
          calendar: cal.summary,
        })
      }
    }
  }

  events.sort((a, b) => String(a.start).localeCompare(String(b.start)))
  return new Response(JSON.stringify({ events }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
