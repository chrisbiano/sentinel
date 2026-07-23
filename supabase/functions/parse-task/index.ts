// Sentyra — the A.I. assistant's brain. Turns a plain-language note into ONE
// structured command: create a task, update an existing one, or complete one.
// It only PROPOSES — the app shows the result and Chris confirms before anything
// saves (create opens the pre-filled form; update/complete show a confirm card).
//
// Deploy with "Verify JWT" ON. Needs ANTHROPIC_API_KEY (same secret triage uses).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const MODEL = 'claude-haiku-4-5'   // structured extraction; cheap is fine

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Canonical "h:mm AM/PM" from whatever the model emitted ("2:30", "14:30",
// "2:30pm"). A bare hour with no meridiem gets the daytime reading — "2:30"
// means 2:30 PM; nobody schedules 2:30 AM by accident.
function normalizeTime(s: string): string {
  const m = String(s || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i)
  if (!m) return String(s || '')
  let h = Number(m[1])
  const mm = m[2] ?? '00'
  const ap = m[3]?.toLowerCase()
  if (ap) {
    h = h % 12
    if (ap.startsWith('p')) h += 12
  } else if (h <= 6) {
    h += 12
  }
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`
}

const SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string', enum: ['create', 'update', 'complete', 'duplicate', 'none'],
      description: 'create a new task; update an existing task; complete (check off) an existing task; duplicate an existing task onto another day/time; none if nothing actionable or the match is too ambiguous',
    },
    taskRef: { type: 'integer', description: 'For update/complete/duplicate: the [n] ref of the matched task. -1 otherwise.' },
    title: { type: 'string', description: 'create: concise task title, no date/time in it. update: a NEW title only if he asked to rename, else "".' },
    date: { type: 'string', description: 'YYYY-MM-DD. create: "" if no date implied. update: the new date only if it changes, else "". duplicate: the target day the copy lands on.' },
    time: { type: 'string', description: '12-hour like "4:00 PM". create: "" if none. update: the new start time only if it changes, else "". duplicate: "" to keep the original\'s time, or the new time.' },
    durationMin: { type: 'integer', description: 'Minutes. create: what he said, else 30. update: the new duration only if it changes, else 0.' },
    subtasks: { type: 'array', items: { type: 'string' }, description: 'create only: short subtask titles if steps were listed, else []' },
    reminder: { type: 'boolean', description: 'create only: true only if a reminder/alert was requested' },
    note: {
      type: 'string',
      description: `One short sentence saying exactly what will happen ("Move 'Rough cut' to Friday 2:00 PM"), or for none: why nothing matched.`,
    },
  },
  required: ['intent', 'taskRef', 'title', 'date', 'time', 'durationMin', 'subtasks', 'reminder', 'note'],
  additionalProperties: false,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!)
  const { data: u, error: uErr } = await admin.auth.getUser(jwt)
  if (uErr || !u?.user) return json({ error: 'unauthorized' }, 401)

  if (!ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY is not set on this function' }, 500)

  let body: any = {}
  try { body = await req.json() } catch { /* none */ }
  const { text, today, weekday, nowTime, tasks } = body
  if (!text || !String(text).trim()) return json({ error: 'Expected { text }' }, 400)

  // Compact roster of his tasks, by [n] ref — Claude matches against these and
  // echoes the ref back, so task ids never round-trip through the model.
  // Includes recently-completed ones, marked (done) — they're duplicatable.
  const roster = (Array.isArray(tasks) ? tasks : [])
    .slice(0, 60)
    .map((t: any) =>
      `[${t.ref}] "${t.title}" — ${t.date || 'no date'}${t.time ? ` ${t.time}` : ' (anytime)'}${t.durationMin ? ` (${t.durationMin} min)` : ''}${t.completed ? ' (done)' : ''}`)
    .join('\n')

  const system = `You are the A.I. assistant inside Sentyra, Chris's daily command center. Turn his note into exactly ONE structured command. Today is ${today || '(unknown)'}${weekday ? ` (${weekday})` : ''}${nowTime ? `, current time ${nowTime}` : ''}, in his local timezone.

His current tasks are listed with [n] refs; ones marked (done) are already completed. Choose the intent:
- "update" — the note changes an existing task IN PLACE: move / push / reschedule / retime / rename / change duration. The same task ends up somewhere else. Match by title words and context (a time like "my 2pm edit" narrows it). Return its taskRef and ONLY the fields that change; leave the rest "" (or 0 for durationMin).
- "duplicate" — the note wants an existing task AGAIN, keeping the original: "add my X from today to tomorrow as well", "same thing again Friday", "copy it to next week", "do it again at 4". Words like also / as well / too / again / copy mean duplicate, not update. Return its taskRef, the target date, and time "" to keep the original's time (or the new time if he gives one). The copy carries the original's duration and subtasks automatically — don't restate them.
- "complete" — the note says an existing task is done / finished / handled / to check off. Return its taskRef.
- "create" — the note describes a NEW task that doesn't refer to any listed one.
- "none" — nothing actionable, or two or more tasks match equally well. Never guess between plausible matches: say in note which ones were ambiguous so he can be specific.

Rules:
- Matching is FORGIVING: case-insensitive, partial names, small typos. "soundbetter" matches "SoundBetter Project"; "the monarch thing" matches "Fix Monarch". Capitalization is never a reason to fail a match. Only use "none" when two genuinely DIFFERENT tasks fit equally well.
- Tasks marked (done) can still be duplicated — "do it again tomorrow" right after finishing something is common. Never pick a (done) task for update or complete.
- If the note says "my X task" (or clearly names a listed task), the intent is NEVER "create" — it's update, duplicate, or complete.
- Resolve relative dates against today: "today", "tomorrow", "Friday", "the 15th" → concrete YYYY-MM-DD.
- Times are 12-hour and MUST include AM or PM — never a bare "2:30". A bare number ("push it to 4") means the sensible clock reading for that task — an afternoon task moved "to 4" means 4:00 PM.
- "at the same time" / "same time" on a duplicate means time "" — keep the original's time; never restate it.
- If he gives a time but no date for a create, assume today (or tomorrow if that time already passed today).
- create durationMin: what he says ("2h" → 120, "45 min" → 45); otherwise 30.
- note: one concrete sentence naming the actual task and the change. He reads it as the confirmation, so a vague note is a useless one.

Example: "add my soundbetter task from today to tomorrow as well at the same time" → intent "duplicate", taskRef of the soundbetter task, date = tomorrow, time "".`

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: `${roster ? `Chris's current open tasks:\n${roster}\n\n` : 'Chris has no open tasks listed.\n\n'}His note: ${String(text).trim()}`,
      }],
    })
    const raw = res.content.find((b: any) => b.type === 'text')?.text ?? '{}'
    const p = JSON.parse(raw)

    // Time hygiene, whatever the model emitted: canonical AM/PM form, and a
    // duplicate whose time matches the source's clock reading (meridiem aside)
    // means "same time" — drop it so the original's time is kept.
    const ref = Number.isInteger(p.taskRef) ? p.taskRef : -1
    let time = p.time ? normalizeTime(p.time) : ''
    if (p.intent === 'duplicate' && time && ref >= 0) {
      const src = (Array.isArray(tasks) ? tasks : []).find((t: any) => t.ref === ref)
      if (src?.time) {
        const clock = (x: string) => String(x).replace(/\s*[AP]\.?M\.?$/i, '').trim()
        if (clock(time) === clock(normalizeTime(src.time))) time = ''
      }
    }

    return json({
      command: {
        intent: p.intent || 'none',
        taskRef: ref,
        title: p.title || '',
        date: p.date || null,
        time: time || null,
        durationMin: Number(p.durationMin) || 0,
        subtasks: Array.isArray(p.subtasks) ? p.subtasks.filter(Boolean) : [],
        reminder: Boolean(p.reminder),
        note: p.note || '',
      },
    })
  } catch (e) {
    return json({ error: `Couldn't read that — try rephrasing. (${(e as Error).message})` }, 502)
  }
})
