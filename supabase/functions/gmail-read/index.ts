// Sentinel — fetch one email's full body so it can be read in-app.
//
// Deploy with "Verify JWT" ON. Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
// No new scope: reading a message is covered by gmail.modify, already granted —
// so this needs no reconnect.
//
// Read-only: it fetches and returns a message; it changes nothing. The full
// HTML is rendered client-side inside a locked-down sandboxed iframe, and we
// strip <script> here too as defense in depth.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })

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

function b64urlToText(data: string) {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const findHeader = (headers: any[], name: string) =>
  headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

// The full renderable body — prefer text/html, fall back to plain text wrapped
// so it's still readable. Unlike the classifier's extractor, nothing is
// truncated or quote-stripped: this is for reading the message as it is.
function extractHtml(payload: any): string {
  let html = ''
  let plain = ''
  const walk = (p: any) => {
    if (!p) return
    const d = p.body?.data
    if (d) {
      if (p.mimeType === 'text/html') html += b64urlToText(d)
      else if (p.mimeType === 'text/plain') plain += b64urlToText(d)
    }
    for (const c of p.parts ?? []) walk(c)
  }
  walk(payload)

  if (html) return html.replace(/<script[\s\S]*?<\/script>/gi, '')
  const esc = escapeHtml(plain).replace(/\n/g, '<br>')
  return `<div style="font-family:system-ui,-apple-system,sans-serif;color:#111;white-space:normal;line-height:1.5;">${esc}</div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!)
  const { data: u, error: uErr } = await admin.auth.getUser(jwt)
  if (uErr || !u?.user) return json({ error: 'unauthorized' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* none */ }
  const { messageId, accountEmail } = body
  if (!messageId || !accountEmail) {
    return json({ error: 'Expected { messageId, accountEmail }' }, 400)
  }

  // Only read a message that's in his own triaged list — scoped by user id.
  const { data: row } = await admin
    .from('email_verdicts')
    .select('message_id')
    .eq('user_id', u.user.id)
    .eq('account_email', accountEmail)
    .eq('message_id', messageId)
    .single()
  if (!row) return json({ error: 'No such message' }, 404)

  const { data: acct } = await admin
    .from('connected_accounts')
    .select('id, email')
    .eq('user_id', u.user.id)
    .eq('email', accountEmail)
    .single()
  if (!acct) return json({ error: `${accountEmail} is no longer connected` }, 409)

  const token = await freshAccessToken(admin, acct)
  if (!token) return json({ error: `Couldn't refresh access for ${accountEmail}` }, 502)

  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r.ok) return json({ error: `Couldn't load the message (HTTP ${r.status})` }, 502)
  const m = await r.json()
  const headers = m.payload?.headers ?? []

  return json({
    sender: findHeader(headers, 'From'),
    subject: findHeader(headers, 'Subject'),
    to: findHeader(headers, 'To'),
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    html: extractHtml(m.payload),
  })
})
