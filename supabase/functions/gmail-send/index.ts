// Sentinel — reply to an email as Chris, in-thread, with his real Gmail signature.
//
// Deploy with "Verify JWT" ON. Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
// Requires the account to have granted gmail.send (to send) and
// gmail.settings.basic (to read the send-as signature) — see connect.js.
//
// Two modes on one function so the compose window and the send share all the
// setup (token, original-message lookup, signature fetch):
//   preview — return the prefilled To / Subject / From name + signature HTML so
//             the modal shows exactly what will go out. No mail is sent.
//   send    — build a threaded HTML reply (typed body + the untouched signature)
//             and send it, then mark the email handled.
//
// This is the only code in Sentinel that sends mail as Chris. It is
// deliberately reply-only: it answers an existing message it can verify he
// owns, never composes to an arbitrary address.
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

/* ---------- MIME helpers ---------- */

const utf8 = (s: string) => new TextEncoder().encode(s)

// Base64 of a UTF-8 string, in 76-char CRLF-wrapped lines (for the body).
function b64Body(s: string): string {
  const bytes = utf8(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const b64 = btoa(bin)
  return (b64.match(/.{1,76}/g) ?? []).join('\r\n')
}

// URL-safe base64 with no padding, for the raw message Gmail's API wants.
function b64url(s: string): string {
  const bytes = utf8(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// RFC 2047 encoded-word for any header value with non-ASCII (names, subjects).
function encodeHeader(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s
  let bin = ''
  for (const b of utf8(s)) bin += String.fromCharCode(b)
  return `=?UTF-8?B?${btoa(bin)}?=`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const findHeader = (headers: any[], name: string) =>
  headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

/* ---------- Gmail lookups ---------- */

// The original message's threading + reply target. We stored the Gmail id and
// thread id, but not the RFC Message-ID, so re-fetch just the headers we need.
async function originalContext(token: string, gmailId: string) {
  const params = new URLSearchParams({ format: 'metadata' })
  for (const h of ['Message-ID', 'References', 'Subject', 'From', 'Reply-To'])
    params.append('metadataHeaders', h)
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailId}?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r.ok) return null
  const m = await r.json()
  const h = m.payload?.headers ?? []
  const subject = findHeader(h, 'Subject')
  return {
    threadId: m.threadId as string,
    messageId: findHeader(h, 'Message-ID'),         // for In-Reply-To / References
    references: findHeader(h, 'References'),
    replyTo: findHeader(h, 'Reply-To') || findHeader(h, 'From'),
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
  }
}

// The signature Gmail shows for this identity, plus the display name, straight
// from the account's send-as settings — the exact HTML, sent verbatim.
async function sendAsIdentity(token: string, accountEmail: string) {
  const r = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs',
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r.ok) return { displayName: '', signature: '' }
  const j = await r.json()
  const list = j.sendAs ?? []
  const mine = list.find((s: any) => s.sendAsEmail?.toLowerCase() === accountEmail.toLowerCase())
    ?? list.find((s: any) => s.isDefault)
    ?? list[0]
  return {
    displayName: mine?.displayName ?? '',
    signature: mine?.signature ?? '',   // HTML, may be empty
  }
}

/* ---------- handler ---------- */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!)
  const { data: u, error: uErr } = await admin.auth.getUser(jwt)
  if (uErr || !u?.user) return json({ error: 'unauthorized' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* none */ }
  const { messageId, accountEmail, mode } = body
  if (!accountEmail || !['preview', 'send', 'signature'].includes(mode)) {
    return json({ error: 'Expected { accountEmail, mode: preview|send|signature }' }, 400)
  }
  // preview/send answer a specific message; signature just needs the account.
  if ((mode === 'preview' || mode === 'send') && !messageId) {
    return json({ error: 'messageId is required for preview/send' }, 400)
  }

  // The account is the ownership check for every mode (scoped to this user).
  const { data: acct } = await admin
    .from('connected_accounts')
    .select('id, email')
    .eq('user_id', u.user.id)
    .eq('email', accountEmail)
    .single()
  if (!acct) return json({ error: `${accountEmail} is no longer connected` }, 409)

  const token = await freshAccessToken(admin, acct)
  if (!token) return json({ error: `Couldn't refresh access for ${accountEmail}` }, 502)

  // Signature preview: no message involved — just show what would sign a reply.
  // Lets Chris eyeball his signature from Settings without composing anything.
  if (mode === 'signature') {
    const identity = await sendAsIdentity(token, accountEmail)
    return json({
      from: identity.displayName ? `${identity.displayName} <${accountEmail}>` : accountEmail,
      signatureHtml: identity.signature,
    })
  }

  // preview/send: confirm the message is one of his, scoped through his user id.
  const { data: row } = await admin
    .from('email_verdicts')
    .select('message_id, account_email')
    .eq('user_id', u.user.id)
    .eq('account_email', accountEmail)
    .eq('message_id', messageId)
    .single()
  if (!row) return json({ error: 'No such message' }, 404)

  const ctx = await originalContext(token, messageId)
  if (!ctx) return json({ error: 'Could not read the original message' }, 502)
  const identity = await sendAsIdentity(token, accountEmail)

  // Preview: hand the modal everything it needs to show what will go out.
  if (mode === 'preview') {
    return json({
      from: identity.displayName ? `${identity.displayName} <${accountEmail}>` : accountEmail,
      to: ctx.replyTo,
      subject: ctx.subject,
      signatureHtml: identity.signature,
    })
  }

  // Send.
  const { to, subject, text } = body
  if (!to || typeof text !== 'string') {
    return json({ error: 'Expected { to, subject, text } to send' }, 400)
  }
  // Insufficient scope here almost always means the account hasn't been
  // reconnected since gmail.send was added — say so plainly.
  const typed = escapeHtml(text).replace(/\n/g, '<br>')
  const html =
    `<div dir="ltr">${typed}</div>` +
    (identity.signature ? `<br><br>${identity.signature}` : '')

  const fromHeader = identity.displayName
    ? `${encodeHeader(identity.displayName)} <${accountEmail}>`
    : accountEmail
  const references = [ctx.references, ctx.messageId].filter(Boolean).join(' ')

  const headerLines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject || ctx.subject)}`,
    ctx.messageId ? `In-Reply-To: ${ctx.messageId}` : '',
    references ? `References: ${references}` : '',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean)

  const mime = headerLines.join('\r\n') + '\r\n\r\n' + b64Body(html)

  const sendRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: b64url(mime), threadId: ctx.threadId }),
    },
  )
  if (!sendRes.ok) {
    const detail = sendRes.status === 403
      ? 'no send permission — reconnect this account to grant it'
      : `Gmail refused the send (HTTP ${sendRes.status})`
    return json({ error: detail }, 502)
  }

  // Sent — mark it handled so it leaves the list.
  await admin
    .from('email_verdicts')
    .update({ handled_at: new Date().toISOString() })
    .eq('user_id', u.user.id)
    .eq('account_email', accountEmail)
    .eq('message_id', messageId)

  return json({ ok: true })
})
