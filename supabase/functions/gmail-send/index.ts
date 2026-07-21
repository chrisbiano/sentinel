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

// fetch that can't hang: a stalled Google/Gmail read returns null after `ms`
// instead of blocking the whole request until the client gives up. Only used on
// READ calls — never on the actual send, which we must not abort mid-flight.
async function fetchT(url: string, opts: RequestInit = {}, ms = 12000) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) })
  } catch {
    return null
  }
}

async function freshAccessToken(admin: any, account: any) {
  const { data: tok } = await admin
    .from('account_tokens').select('*').eq('account_id', account.id).single()
  if (!tok) return null

  const stillValid = tok.access_token && tok.expires_at &&
    new Date(tok.expires_at).getTime() > Date.now() + 60_000
  if (stillValid) return tok.access_token

  const res = await fetchT('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: tok.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const j = res ? await res.json() : null
  if (!res || !res.ok || !j?.access_token) {
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
// Chunked so a big message (with attachments) doesn't build a huge string
// one char at a time.
function b64url(s: string): string {
  const bytes = utf8(s)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
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

// Split an address header into individual { raw, email }. Keeps the "Name <email>"
// form for display and lowercases the email for dedup/exclusion. Good enough for
// the commas Gmail emits (a quoted "Last, First" name may lose its display half,
// but the email — all we key on — survives).
function parseAddresses(header: string) {
  return (header || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/<([^>]+)>/)
      const email = (m ? m[1] : raw).trim().toLowerCase()
      return { raw, email }
    })
    .filter((a) => a.email.includes('@'))
}

// Reply-all recipients: everyone on the original's To + Cc, minus the person
// we're replying to (they go in To) and minus our own address. Deduped by email.
function replyAllCc(toHeader: string, ccHeader: string, replyToEmail: string, selfEmail: string) {
  const exclude = new Set([replyToEmail, selfEmail].filter(Boolean).map((e) => e.toLowerCase()))
  const seen = new Set<string>()
  return [...parseAddresses(toHeader), ...parseAddresses(ccHeader)]
    .filter((a) => {
      if (exclude.has(a.email) || seen.has(a.email)) return false
      seen.add(a.email)
      return true
    })
    .map((a) => a.raw)
    .join(', ')
}

/* ---------- Gmail lookups ---------- */

// The original message's threading + reply target. We stored the Gmail id and
// thread id, but not the RFC Message-ID, so re-fetch just the headers we need.
async function originalContext(token: string, gmailId: string) {
  const params = new URLSearchParams({ format: 'metadata' })
  for (const h of ['Message-ID', 'References', 'Subject', 'From', 'Reply-To', 'To', 'Cc'])
    params.append('metadataHeaders', h)
  const r = await fetchT(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailId}?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r || !r.ok) return null
  const m = await r.json()
  const h = m.payload?.headers ?? []
  const subject = findHeader(h, 'Subject')
  return {
    threadId: m.threadId as string,
    messageId: findHeader(h, 'Message-ID'),         // for In-Reply-To / References
    references: findHeader(h, 'References'),
    replyTo: findHeader(h, 'Reply-To') || findHeader(h, 'From'),
    to: findHeader(h, 'To'),                         // for reply-all
    cc: findHeader(h, 'Cc'),
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
  }
}

// The signature Gmail shows for this identity, plus the display name, straight
// from the account's send-as settings — the exact HTML, sent verbatim.
async function sendAsIdentity(token: string, accountEmail: string) {
  const r = await fetchT(
    'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs',
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r || !r.ok) return { displayName: '', signature: '' }
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

function b64urlToText(data: string) {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

// The original's full renderable body + headers, for quoting into a forward.
async function originalFull(token: string, gmailId: string) {
  const r = await fetchT(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!r || !r.ok) return null
  const m = await r.json()
  const h = m.payload?.headers ?? []

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
  walk(m.payload)
  const bodyHtml = html
    ? html.replace(/<script[\s\S]*?<\/script>/gi, '')
    : `<div style="white-space:pre-wrap">${escapeHtml(plain)}</div>`

  return {
    subject: findHeader(h, 'Subject'),
    from: findHeader(h, 'From'),
    to: findHeader(h, 'To'),
    date: findHeader(h, 'Date'),
    bodyHtml,
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
  if (!accountEmail || !['preview', 'send', 'signature', 'forward'].includes(mode)) {
    return json({ error: 'Expected { accountEmail, mode: preview|send|signature|forward }' }, 400)
  }
  // signature just needs the account; every other mode answers a message.
  if (mode !== 'signature' && !messageId) {
    return json({ error: 'messageId is required for this mode' }, 400)
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

  // preview/send/forward: confirm the message is one of his.
  const { data: row } = await admin
    .from('email_verdicts')
    .select('message_id, account_email')
    .eq('user_id', u.user.id)
    .eq('account_email', accountEmail)
    .eq('message_id', messageId)
    .single()
  if (!row) return json({ error: 'No such message' }, 404)

  // Forward: quote the whole original and pass it on to a new recipient. It's a
  // fresh thread (no In-Reply-To) and is NOT marked handled — forwarding an
  // email doesn't mean you've dealt with it.
  if (mode === 'forward') {
    const { to, text } = body
    if (!to || typeof text !== 'string') {
      return json({ error: 'Expected { to, text } to forward' }, 400)
    }
    // Signature + full original in parallel — two Gmail reads, one wait.
    const [identity, orig] = await Promise.all([
      sendAsIdentity(token, accountEmail),
      originalFull(token, messageId),
    ])
    if (!orig) return json({ error: 'Could not read the original message' }, 502)
    const fromHeader = identity.displayName
      ? `${encodeHeader(identity.displayName)} <${accountEmail}>`
      : accountEmail

    const typed = escapeHtml(text).replace(/\n/g, '<br>')
    const fwdSubject = /^fwd:/i.test(orig.subject) ? orig.subject : `Fwd: ${orig.subject}`
    const forwarded =
      '<br><br><div style="color:#777">---------- Forwarded message ---------<br>' +
      `From: ${escapeHtml(orig.from)}<br>` +
      (orig.date ? `Date: ${escapeHtml(orig.date)}<br>` : '') +
      `Subject: ${escapeHtml(orig.subject)}<br>` +
      (orig.to ? `To: ${escapeHtml(orig.to)}<br>` : '') +
      '</div><br>'
    const html =
      `<div dir="ltr">${typed}</div>` +
      (identity.signature ? `<br><br>${identity.signature}` : '') +
      forwarded + orig.bodyHtml

    const lines = [
      `From: ${fromHeader}`,
      `To: ${to}`,
      `Subject: ${encodeHeader(fwdSubject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
    ]
    const mime = lines.join('\r\n') + '\r\n\r\n' + b64Body(html)
    const res = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: b64url(mime) }),   // new thread
      },
    )
    if (!res.ok) {
      const detail = res.status === 403
        ? 'no send permission — reconnect this account to grant it'
        : `Gmail refused the forward (HTTP ${res.status})`
      return json({ error: detail }, 502)
    }
    return json({ ok: true })
  }

  // preview / send: signature + reply-threading context in parallel, so the
  // compose modal isn't waiting on two sequential Gmail round-trips.
  const [identity, ctx] = await Promise.all([
    sendAsIdentity(token, accountEmail),
    originalContext(token, messageId),
  ])
  if (!ctx) return json({ error: 'Could not read the original message' }, 502)
  const fromHeader = identity.displayName
    ? `${encodeHeader(identity.displayName)} <${accountEmail}>`
    : accountEmail

  // Preview: hand the modal everything it needs to show what will go out —
  // including the reply-all Cc list, so the modal can offer "Reply all".
  if (mode === 'preview') {
    const replyToEmail = parseAddresses(ctx.replyTo)[0]?.email ?? ''
    return json({
      from: identity.displayName ? `${identity.displayName} <${accountEmail}>` : accountEmail,
      to: ctx.replyTo,
      cc: replyAllCc(ctx.to, ctx.cc, replyToEmail, accountEmail),
      subject: ctx.subject,
      signatureHtml: identity.signature,
    })
  }

  // Send. `cc` is present only when Chris chose Reply all (he can edit it);
  // `attachments` is present only when he attached files.
  const { to, cc, subject, text, attachments } = body
  if (!to || typeof text !== 'string') {
    return json({ error: 'Expected { to, subject, text } to send' }, 400)
  }
  const atts = Array.isArray(attachments)
    ? attachments.filter((a: any) => a?.dataB64 && a?.filename)
    : []
  // Guard the total size server-side too (base64 of ~10MB ≈ 14MB of text).
  const attBytes = atts.reduce((n: number, a: any) => n + String(a.dataB64).length, 0)
  if (attBytes > 15 * 1024 * 1024) {
    return json({ error: 'Attachments are too large (10 MB max).' }, 413)
  }

  // Insufficient scope here almost always means the account hasn't been
  // reconnected since gmail.send was added — say so plainly.
  const typed = escapeHtml(text).replace(/\n/g, '<br>')
  const html =
    `<div dir="ltr">${typed}</div>` +
    (identity.signature ? `<br><br>${identity.signature}` : '')

  const references = [ctx.references, ctx.messageId].filter(Boolean).join(' ')

  const baseHeaders = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : '',
    `Subject: ${encodeHeader(subject || ctx.subject)}`,
    ctx.messageId ? `In-Reply-To: ${ctx.messageId}` : '',
    references ? `References: ${references}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean)

  let mime: string
  if (atts.length) {
    // multipart/mixed: the HTML reply, then each file as a base64 attachment.
    const boundary = `b_${crypto.randomUUID().replace(/-/g, '')}`
    let parts =
      `--${boundary}\r\n` +
      'Content-Type: text/html; charset="UTF-8"\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      b64Body(html) + '\r\n'
    for (const a of atts) {
      const fname = String(a.filename).replace(/["\r\n]/g, '')
      const ctype = String(a.mimeType || 'application/octet-stream').replace(/[\r\n]/g, '')
      const wrapped = (String(a.dataB64).match(/.{1,76}/g) ?? []).join('\r\n')
      parts +=
        `--${boundary}\r\n` +
        `Content-Type: ${ctype}; name="${encodeHeader(fname)}"\r\n` +
        `Content-Disposition: attachment; filename="${encodeHeader(fname)}"\r\n` +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        wrapped + '\r\n'
    }
    parts += `--${boundary}--`
    mime = [...baseHeaders, `Content-Type: multipart/mixed; boundary="${boundary}"`].join('\r\n') +
      '\r\n\r\n' + parts
  } else {
    mime = [...baseHeaders,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
    ].join('\r\n') + '\r\n\r\n' + b64Body(html)
  }

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
