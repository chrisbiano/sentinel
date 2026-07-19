// Sentinel — draft a reply for Chris. He gives a one-line intent ("yes, Tuesday
// works"); Claude reads the email he's replying to and writes the reply body in
// his voice. It NEVER sends — the draft lands in the compose box for Chris to
// edit and send himself. (Sending stays in gmail-send.)
//
// Deploy with "Verify JWT" ON. Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and
// ANTHROPIC_API_KEY (same secret gmail-messages uses).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

// Opus for the best voice-matching on a low-volume, on-demand task (unlike the
// high-volume triage, which runs on Haiku). Swap to 'claude-sonnet-5' or
// 'claude-haiku-4-5' here to cut per-draft cost if you'd rather.
const MODEL = 'claude-opus-4-8'
const BODY_CHARS = 3000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function freshAccessToken(admin: any, account: any) {
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
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
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

/* ---------- Gmail payload wrangling (same as gmail-messages) ---------- */
function b64urlToText(data: string) {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}
function stripHtml(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
}
function extractBody(payload: any): string {
  const plain: string[] = []
  const html: string[] = []
  const walk = (part: any) => {
    if (!part) return
    const data = part.body?.data
    if (data) {
      if (part.mimeType === 'text/plain') plain.push(b64urlToText(data))
      else if (part.mimeType === 'text/html') html.push(b64urlToText(data))
    }
    for (const p of part.parts ?? []) walk(p)
  }
  walk(payload)
  const raw = plain.length ? plain.join('\n') : stripHtml(html.join('\n'))
  return raw
    .split(/^\s*(On .{0,80}wrote:|-{2,}\s*Original Message|_{5,})/m)[0]
    .replace(/\s+/g, ' ').trim().slice(0, BODY_CHARS)
}
const header = (headers: any[], name: string) =>
  headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
function parseFrom(value: string) {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: (m[1].trim() || m[2].trim()), email: m[2].trim() }
  return { name: value.trim(), email: value.trim() }
}
const firstName = (name: string) => (name || '').trim().split(/\s+/)[0].replace(/[",]/g, '')

/* ---------- Claude ---------- */
function buildSystem(purpose: string | null) {
  const ctx = purpose?.trim()
    ? `This mailbox is: ${purpose.trim()}.`
    : `Chris hasn't described this mailbox, so keep the tone neutral-professional and don't assume it's business or personal.`
  return `You draft email replies on behalf of Chris Biano. He owns and runs Fast Rose Creative, a video production company (he shoots and edits for clients), and he also plays in a band. ${ctx}

You'll get the email Chris is replying to and a short note from Chris about what he wants to say back. Write the reply body in his voice.

Voice and rules:
- Sound like a real, busy person: warm but direct, professional without being stiff. Concise — most good replies are 2–5 sentences. No corporate filler, no "I hope this email finds you well," no throat-clearing.
- Say ONLY what Chris's note and the original email support. Never invent facts, dates, times, prices, names, or commitments he didn't give you. If his note is brief, keep the reply brief — do not pad it.
- Match the relationship: a client, a vendor, a bandmate, and a friend each get a different register. Read the original to gauge it.
- Open with a natural greeting using the recipient's first name when you know it. You may end with a short sign-off line like "Thanks," or "Best," but DO NOT write Chris's name, company, title, or any contact block — his signature is added automatically after your text.
- Output ONLY the reply body, ready to paste and send. No subject line, no quoting the original, no "Here's a draft" preamble, no notes to Chris.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!)
  const { data: u, error: uErr } = await admin.auth.getUser(jwt)
  if (uErr || !u?.user) return json({ error: 'unauthorized' }, 401)

  if (!ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY is not set on this function' }, 500)

  let body: any = {}
  try { body = await req.json() } catch { /* no body */ }
  const { messageId, accountEmail, intent } = body
  if (!messageId || !accountEmail) {
    return json({ error: 'Expected { messageId, accountEmail, intent }' }, 400)
  }

  const { data: acct } = await admin
    .from('connected_accounts')
    .select('id, email, purpose')
    .eq('user_id', u.user.id)
    .eq('email', accountEmail)
    .single()
  if (!acct) {
    return json({ error: 'account_not_connected', message: `${accountEmail} is no longer connected. Reconnect it in Settings.` }, 409)
  }

  const token = await freshAccessToken(admin, acct)
  if (!token) {
    return json({ error: 'account_needs_reconnect', message: `${acct.email} needs to be reconnected in Settings — its access has expired.` }, 502)
  }

  // Fetch the message being replied to for context.
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r.ok) return json({ error: `Couldn't read the original email (HTTP ${r.status})` }, 502)
  const m = await r.json()
  const headers = m.payload?.headers ?? []
  const from = parseFrom(header(headers, 'From'))
  const original = {
    fromName: from.name,
    firstName: firstName(from.name),
    subject: header(headers, 'Subject'),
    body: extractBody(m.payload) || m.snippet || '',
  }

  const userMsg = [
    `The email Chris is replying to:`,
    `From: ${original.fromName}${original.firstName ? ` (first name: ${original.firstName})` : ''}`,
    `Subject: ${original.subject || '(no subject)'}`,
    `Body: ${original.body || '(empty)'}`,
    ``,
    `What Chris wants to say back:`,
    (intent && intent.trim()) ? intent.trim() : '(No note — write a brief, sensible reply that fits what the email is asking.)',
    ``,
    `Write the reply body now.`,
  ].join('\n')

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystem(acct.purpose),
      messages: [{ role: 'user', content: userMsg }],
    })
    const draft = (res.content.find((b: any) => b.type === 'text')?.text ?? '').trim()
    if (!draft) return json({ error: 'The draft came back empty — try again or write it yourself.' }, 502)
    return json({ draft })
  } catch (e) {
    return json({ error: `Drafting failed: ${String((e as Error).message)}` }, 502)
  }
})
