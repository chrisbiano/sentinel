// Sentinel — turn a quick natural-language note into a structured task. It only
// PARSES; it never saves. The app opens the task form pre-filled with the result
// so Chris eyeballs it and hits Save (proposes, you approve).
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

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Concise task title, no date/time in it' },
    date: { type: 'string', description: 'YYYY-MM-DD the task is for, or "" if none was implied' },
    time: { type: 'string', description: 'Start time like "10:00 AM" (12-hour), or "" if none' },
    durationMin: { type: 'integer', description: 'Minutes; default 30 if not stated' },
    subtasks: { type: 'array', items: { type: 'string' }, description: 'Short subtask titles if steps were listed' },
    reminder: { type: 'boolean', description: 'True only if a reminder/alert was requested' },
  },
  required: ['title', 'date', 'time', 'durationMin', 'subtasks', 'reminder'],
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
  const { text, today, weekday, nowTime } = body
  if (!text || !String(text).trim()) return json({ error: 'Expected { text }' }, 400)

  const system = `You convert Chris's quick note into a single structured task for Sentinel. Today is ${today || '(unknown)'}${weekday ? ` (${weekday})` : ''}${nowTime ? `, current time ${nowTime}` : ''}, in his local timezone.

Rules:
- Resolve relative dates against today: "today", "tomorrow", "next Tuesday", "the 15th" → a concrete YYYY-MM-DD. If no date is implied at all, leave date "".
- If a time is given, use 12-hour like "2:00 PM". If none, leave time "".
- If he gives a time but no date, assume today (or tomorrow if that time already passed today).
- durationMin: use what he says ("2h" → 120, "45 min" → 45); otherwise 30.
- subtasks: if he lists steps ("with subtasks a, b, c" or "steps: …"), split them into short titles; otherwise [].
- reminder: true only if he explicitly wants to be reminded/alerted; otherwise false.
- title: the core task, cleaned of the date/time/subtask phrasing.
Return exactly one task.`

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: String(text).trim() }],
    })
    const raw = res.content.find((b: any) => b.type === 'text')?.text ?? '{}'
    const p = JSON.parse(raw)
    // Empty strings → null; hand back app-shaped fields the task form understands.
    return json({
      task: {
        title: p.title || '',
        date: p.date || null,
        time: p.time || null,
        durationMin: Number(p.durationMin) || 30,
        subtasks: Array.isArray(p.subtasks) ? p.subtasks.filter(Boolean) : [],
        reminder: Boolean(p.reminder),
      },
    })
  } catch (e) {
    return json({ error: `Couldn't parse that — try rephrasing, or add it manually. (${(e as Error).message})` }, 502)
  }
})
