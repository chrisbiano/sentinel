// Sentyra — generate the signed-in user's daily brief, on demand. It's a living
// summary that reflects the current time of day, so it's regenerated through the
// day (on reopen after it goes stale), not written once at dawn.
// The app shows it as a dismissible card at the top of the dashboard (it lives
// there until dismissed), so the brief never depends on push delivery.
//
// Deploy with "Verify JWT" ON. Reuses the scheduler's secrets:
//   ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (for the day's calendar).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
const MODEL = 'claude-haiku-4-5'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function fetchT(url: string, opts: RequestInit = {}, ms = 10000) {
  try { return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }) } catch { return null }
}

async function freshAccessToken(admin: any, account: any) {
  const { data: tok } = await admin.from('account_tokens').select('*').eq('account_id', account.id).single()
  if (!tok) return null
  if (tok.access_token && tok.expires_at && new Date(tok.expires_at).getTime() > Date.now() + 60_000) return tok.access_token
  const res = await fetchT('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, refresh_token: tok.refresh_token, grant_type: 'refresh_token' }),
  })
  const j = res ? await res.json() : null
  if (!res || !res.ok || !j?.access_token) return null
  await admin.from('account_tokens').update({
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
  }).eq('account_id', account.id)
  return j.access_token
}

// The user's current wall-clock time in their zone. Without this the brief has
// no idea how far into the day it is, so it recaps the whole day as if it were
// dawn — the only progress signal it otherwise has is which tasks are checked
// off. Runs in UTC, so read the time through the zone via Intl.
function localNow(tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date())
}

// "YYYY-MM-DD" + 1 day (pure date arithmetic, no timezone involved).
function nextDay(localDate: string): string {
  const [Y, M, D] = localDate.split('-').map(Number)
  return new Date(Date.UTC(Y, M - 1, D + 1)).toISOString().slice(0, 10)
}

// The UTC instant of local midnight in `tz` on `localDate`. The function runs in
// UTC, so parsing "YYYY-MM-DDT00:00:00" directly would be UTC midnight — shifting
// the whole day window by the user's offset (which is how yesterday's evening
// events leaked into today's brief). Guess UTC midnight, see what wall-clock that
// is in the zone, and correct by the difference.
function zonedMidnightUTC(localDate: string, tz: string): Date {
  const [Y, M, D] = localDate.split('-').map(Number)
  const guess = new Date(Date.UTC(Y, M - 1, D, 0, 0, 0))
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  const p: Record<string, string> = {}
  for (const part of f.formatToParts(guess)) if (part.type !== 'literal') p[part.type] = part.value
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return new Date(guess.getTime() - (asUTC - guess.getTime()))
}

// Best-effort: the day's event titles + times across the user's calendars.
// Events Chris has "wrapped up" in Sentyra (event_notes.done) are marked (done)
// so the brief never presents a finished block as still ahead.
async function eventsToday(admin: any, userId: string, localDate: string, tz: string, wrapped: Set<string>) {
  try {
    // The user's local day, as real UTC instants.
    const timeMin = zonedMidnightUTC(localDate, tz).toISOString()
    const timeMax = zonedMidnightUTC(nextDay(localDate), tz).toISOString()
    const { data: accounts } = await admin
      .from('connected_accounts').select('id, email').eq('user_id', userId).eq('provider', 'google')
    const per = await Promise.all((accounts ?? []).map(async (acct: any) => {
      const token = await freshAccessToken(admin, acct)
      if (!token) return []
      const auth = { Authorization: `Bearer ${token}` }
      const calRes = await fetchT('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader', { headers: auth })
      if (!calRes || !calRes.ok) return []
      const cals = ((await calRes.json()).items ?? []).filter((c: any) => c.selected !== false)
      const evs = await Promise.all(cals.map(async (cal: any) => {
        const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '25' })
        const r = await fetchT(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`, { headers: auth })
        if (!r || !r.ok) return []
        return ((await r.json()).items ?? [])
          .filter((e: any) => e.status !== 'cancelled' && e.start?.dateTime)
          .map((e: any) => {
            const t = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(e.start.dateTime))
            const done = wrapped.has(`${acct.email}:${cal.id}:${e.id}`) ? ' (done)' : ''
            return `${t} — ${e.summary || '(no title)'}${done}`
          })
      }))
      return evs.flat()
    }))
    return per.flat().slice(0, 12)
  } catch { return [] }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!)
  const { data: u, error: uErr } = await admin.auth.getUser(jwt)
  if (uErr || !u?.user) return json({ error: 'unauthorized' }, 401)
  if (!ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY is not set on this function' }, 500)

  const userId = u.user.id
  let body: any = {}
  try { body = await req.json() } catch { /* none */ }
  const tz = body.tz || 'UTC'
  const date = body.today || new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())

  const { data: tasks } = await admin
    .from('tasks').select('title, time, completed')
    .eq('user_id', userId).eq('date', date).is('deleted_at', null)
  const openTasks = (tasks ?? []).filter((t: any) => !t.completed)
  const { count: needReply } = await admin
    .from('email_verdicts').select('*', { count: 'exact', head: true })
    .eq('user_id', userId).eq('action', 'reply').is('handled_at', null)
  // Events he's already wrapped up in Sentyra — marked (done) in the roster.
  const { data: wrappedRows } = await admin
    .from('event_notes').select('event_id').eq('user_id', userId).eq('done', true)
  const wrapped = new Set((wrappedRows ?? []).map((w: any) => w.event_id))
  const events = await eventsToday(admin, userId, date, tz, wrapped)

  const facts = [
    `Today's date: ${date}. Right now it is ${localNow(tz)}.`,
    events.length ? `Calendar today:\n${events.map((e) => `- ${e}`).join('\n')}` : 'Calendar today: nothing scheduled.',
    openTasks.length
      ? `Open tasks today:\n${openTasks.map((t: any) => `- ${t.title}${t.time ? ` (${t.time})` : ''}`).join('\n')}`
      : 'Open tasks today: none.',
    `Emails needing a reply: ${needReply ?? 0}.`,
  ].join('\n\n')

  let brief = ''
  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: `You write Chris's one-glance daily brief for Sentyra, his daily command center. He runs a video production company and plays in a band. This is a LIVING brief he may open at any hour, and the current time is given — anchor everything to it. Speak to what's still ahead from now; do NOT recap the whole day as if it's morning. Anything scheduled before the current time has already passed — treat it as behind him (done or missed), not upcoming. Match the tone to the time of day: morning = the day ahead, midday/afternoon = what's left, evening = wrap-up (and a nod to tomorrow if today is basically done). Anything marked (done) is already finished — never present it as pending or ahead. Given the facts, write 2–4 short sentences (or tight lines) naming the actual things that matter right now: what's still on the schedule, anything time-sensitive, and what's waiting on him. Warm, direct, concrete. No greeting like "Good morning", no filler, no markdown headers. If little remains, say so briefly. Plain text only.`,
      messages: [{ role: 'user', content: facts }],
    })
    brief = (res.content.find((b: any) => b.type === 'text')?.text ?? '').trim()
  } catch (e) {
    console.error('brief generation failed', (e as Error).message)
  }
  if (!brief) {
    brief = `${events.length} event${events.length === 1 ? '' : 's'}, ${openTasks.length} task${openTasks.length === 1 ? '' : 's'}, and ${needReply ?? 0} email${(needReply ?? 0) === 1 ? '' : 's'} to reply to.`
  }

  return json({ brief, date })
})
