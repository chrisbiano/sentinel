// Sentinel — the heartbeat. Supabase Cron pings this every minute; it fires due
// task reminders and sends the morning brief. It runs system-wide (no user JWT),
// so it's gated by a shared secret header instead.
//
// Deploy with "Verify JWT" OFF. Needs secrets:
//   CRON_SECRET         — matched against the x-cron-secret header the cron sends
//   VAPID_PRIVATE_KEY   — same one push-send uses
//   VAPID_PUBLIC_KEY    — the public half (VITE_VAPID_PUBLIC_KEY's value)
//   VAPID_SUBJECT       — e.g. mailto:chris@fastrosecreative.com
//   ANTHROPIC_API_KEY   — for the brief (same secret gmail-messages uses)
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — to read the day's calendar
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import Anthropic from 'npm:@anthropic-ai/sdk'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:sentinel@example.com'
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')

const BRIEF_MODEL = 'claude-haiku-4-5'   // cheap; it's a daily summary
const BRIEF_HOUR = 7                       // 7am local
const REMINDER_GRACE_MIN = 30              // fire reminders due within the last 30m

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function fetchT(url: string, opts: RequestInit = {}, ms = 10000) {
  try { return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }) } catch { return null }
}

/* ---------- push ---------- */
async function sendToUser(admin: any, userId: string, payload: unknown) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  const { data: subs } = await admin
    .from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId)
  const body = JSON.stringify(payload)
  const dead: string[] = []
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body)
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.id)
      else console.error('push error', e?.statusCode, e?.message)
    }
  }
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead)
  return (subs ?? []).length
}

/* ---------- reminders ---------- */
async function fireReminders(admin: any) {
  const now = Date.now()
  const { data: due } = await admin
    .from('tasks')
    .select('id, user_id, title, time')
    .eq('has_reminder', true)
    .eq('completed', false)
    .is('reminder_fired_at', null)
    .lte('remind_at', new Date(now).toISOString())
    .gte('remind_at', new Date(now - REMINDER_GRACE_MIN * 60_000).toISOString())
  let fired = 0
  for (const t of due ?? []) {
    await sendToUser(admin, t.user_id, {
      title: `⏰ ${t.title}`,
      body: t.time ? `Now — was due at ${t.time}` : 'Reminder',
      tag: `task-${t.id}`,
      renotify: true,
      url: '/',
    })
    await admin.from('tasks').update({ reminder_fired_at: new Date().toISOString() }).eq('id', t.id)
    fired++
  }
  return fired
}

/* ---------- morning brief ---------- */
// Local wall-clock parts for an IANA timezone, without pulling in a tz library.
function localParts(tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const p: Record<string, string> = {}
  for (const part of f.formatToParts(new Date())) if (part.type !== 'literal') p[part.type] = part.value
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) }
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

// Best-effort: the day's event titles + times across the user's calendars. If it
// fails, the brief still goes out with tasks + email — never block on calendar.
async function eventsToday(admin: any, userId: string, localDate: string, tz: string) {
  try {
    const start = new Date(`${localDate}T00:00:00`)
    const timeMin = new Date(start).toISOString()
    const timeMax = new Date(start.getTime() + 86_400_000).toISOString()
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
            return `${t} — ${e.summary || '(no title)'}`
          })
      }))
      return evs.flat()
    }))
    return per.flat().slice(0, 12)
  } catch { return [] }
}

async function sendBriefs(admin: any) {
  if (!ANTHROPIC_API_KEY) return 0
  const { data: prefs } = await admin
    .from('user_prefs').select('user_id, timezone, last_brief_on').eq('morning_brief', true)
  let sent = 0
  for (const p of prefs ?? []) {
    if (!p.timezone) continue
    const { date, hour, minute } = localParts(p.timezone)
    // Fire once in the 7:00–7:04 window, and only if we haven't today.
    if (hour !== BRIEF_HOUR || minute > 4 || p.last_brief_on === date) continue

    const { data: tasks } = await admin
      .from('tasks').select('title, time, completed').eq('user_id', p.user_id).eq('date', date)
    const openTasks = (tasks ?? []).filter((t: any) => !t.completed)
    const { count: needReply } = await admin
      .from('email_verdicts').select('*', { count: 'exact', head: true })
      .eq('user_id', p.user_id).eq('action', 'reply').is('handled_at', null)
    const events = await eventsToday(admin, p.user_id, date, p.timezone)

    const facts = [
      `Today's date: ${date}.`,
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
        model: BRIEF_MODEL,
        max_tokens: 400,
        system: `You write Chris's one-glance morning brief for Sentinel, his daily command center. He runs a video production company and plays in a band. Given the day's facts, write 2–4 short sentences (or tight lines) that tell him what matters today: the shape of his schedule, anything time-sensitive, and what's waiting on him. Warm, direct, concrete — name the actual things. No greeting like "Good morning", no filler, no markdown headers. If the day is light, say so briefly. Plain text only.`,
        messages: [{ role: 'user', content: facts }],
      })
      brief = (res.content.find((b: any) => b.type === 'text')?.text ?? '').trim()
    } catch (e) {
      console.error('brief generation failed', (e as Error).message)
    }
    if (!brief) {
      brief = `${events.length} event${events.length === 1 ? '' : 's'}, ${openTasks.length} task${openTasks.length === 1 ? '' : 's'}, and ${needReply ?? 0} email${(needReply ?? 0) === 1 ? '' : 's'} to reply to.`
    }

    await sendToUser(admin, p.user_id, {
      title: '☀️ Your day',
      body: brief,
      tag: 'morning-brief',
      renotify: true,
      url: '/',
    })
    await admin.from('user_prefs').update({ last_brief_on: date }).eq('user_id', p.user_id)
    sent++
  }
  return sent
}

Deno.serve(async (req) => {
  // No user JWT — gate on the shared secret the cron sends.
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'forbidden' }, 403)
  }
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!)
  try {
    const fired = await fireReminders(admin)
    const briefs = await sendBriefs(admin)
    return json({ ok: true, reminders: fired, briefs })
  } catch (e) {
    console.error('tick failed', (e as Error).message)
    return json({ error: (e as Error).message }, 500)
  }
})
