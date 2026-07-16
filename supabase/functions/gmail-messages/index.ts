// Sentinel — pull recent mail from every connected Google account and let Claude
// sort it into what Chris would actually DO with it.
//
// Deploy with "Verify JWT" ON: the app calls this with the user's login token.
// Needs secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ANTHROPIC_API_KEY.
//
// Incremental by design. Each run lists message ids (cheap), diffs them against
// verdicts we already have, and classifies at most MAX_PER_RUN of the leftovers.
// That keeps a single invocation well inside the function timeout even on the
// first run against six backlogged inboxes — the app just calls again until
// `remaining` hits zero.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

// Chris picked Haiku: this is high-volume triage across six mailboxes, and the
// judgment call per message is small even if the reasoning matters.
const MODEL = 'claude-haiku-4-5'
const MAX_PER_RUN = 20         // messages classified per invocation (one Claude call)
// Gmail returns newest first. This has to comfortably exceed a week's mail in a
// busy mailbox or the older half of the window is never even looked at — it
// wouldn't error, it would just quietly never appear in the list.
const LIST_PER_ACCOUNT = 100
const BODY_CHARS = 1500        // enough to find an ask buried a few paragraphs down

// supabase-js sends x-client-info/apikey on invoke — all of them must be
// allow-listed or the browser's preflight blocks the request.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })

// Google access tokens last ~1h; mint a fresh one from the refresh token when needed.
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

/* ---------- Gmail payload wrangling ---------- */

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
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
}

// Gmail nests bodies in an arbitrarily deep MIME tree. Prefer text/plain; fall
// back to de-tagged HTML, which is all most marketing mail has.
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
    // Quoted trailers turn every thread into the whole thread. Cut at the seam.
    .split(/^\s*(On .{0,80}wrote:|-{2,}\s*Original Message|_{5,})/m)[0]
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BODY_CHARS)
}

const header = (headers: any[], name: string) =>
  headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

// RFC 8058: a List-Unsubscribe-Post header means the https URL is a true
// one-click endpoint. Without it, the URL is just a page to open.
function unsubscribeInfo(headers: any[]) {
  const raw = header(headers, 'List-Unsubscribe')
  if (!raw) return { url: null as string | null, oneClick: false }
  const https = raw.match(/<(https:\/\/[^>]+)>/)?.[1] ?? null
  const oneClick = /one-click/i.test(header(headers, 'List-Unsubscribe-Post'))
  return { url: https, oneClick: Boolean(https && oneClick) }
}

function parseFrom(value: string) {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() }
  return { name: value.trim(), email: value.trim().toLowerCase() }
}

/* ---------- Claude ---------- */

/* Chris wears several hats — the video company, his band, personal life — and
   the same email can be urgent in one mailbox and junk in another. So the
   mailbox roster (written by him, in Settings) is built into the prompt rather
   than hardcoded here: he adds an account, he describes it, Claude adapts. A
   mailbox he hasn't described is called out as such so Claude stays cautious
   instead of confidently inventing a context for it. */
function buildSystem(accounts: { email: string; purpose: string | null }[]) {
  const roster = accounts.map((a) =>
    a.purpose?.trim()
      ? `- ${a.email} — ${a.purpose.trim()}`
      : `- ${a.email} — (Chris hasn't described this mailbox. You don't know what it's for, so judge conservatively: prefer "read" over "junk" for anything written by a real human, and don't assume it's business mail.)`
  ).join('\n')

  return `You are triaging email for Chris Biano across several mailboxes.

Chris wears more than one hat, and this is the single most important thing to get right. He owns and runs Fast Rose Creative, a video production company — he shoots and edits for clients (one is the artist and podcast host Calvin Nowell), and proposals, scheduling, invoices, and deliverable questions all land on him personally. He also plays in a band. He also has ordinary personal mail. Some mailboxes mix business and personal freely.

The mailbox an email arrived in is a primary signal, not a footnote. The same message can be junk in one and urgent in another: a venue asking about dates is critical on a band address and cold outreach on a business one. A note from a friend is noise in a client inbox and the whole point in a personal one. Read the mailbox description first, then the email.

Chris's mailboxes, in his own words:
${roster}

Sort each email into exactly one action — what Chris should DO with it:`
}

const RUBRIC = `

"reply" — A specific human is waiting on a response from Chris and cannot proceed without it. A direct question, a request for a decision or approval, a proposal awaiting yes/no, a scheduling ask, a client asking where a deliverable is, a vendor needing an answer. If someone would reasonably follow up asking "did you see my email?", it is a reply.

"read" — Real information addressed to Chris, but nothing is blocked on him. Receipts, invoices paid, booking confirmations, delivery notices, a client saying "thanks, looks great", software notifications that matter, a thread where Chris already sent the last word and this is just an acknowledgement.

"unsubscribe" — Recurring bulk mail he opted into but does not need: newsletters, product marketing, digests, webinar invitations, drip campaigns. Choose this over "junk" whenever the sender is a legitimate business sending on a schedule — those have working unsubscribe links, and unsubscribing stops the bleeding permanently.

"junk" — One-off noise with no ongoing relationship: cold sales outreach, spam, phishing, scraped-list pitches, anything from a sender he has no relationship with and who will not send again on a schedule.

How to judge:
- Judge against the mailbox this arrived in, not against Chris in general. An email that would be cold outreach in one mailbox can be exactly what another mailbox exists to receive. Check the description before you decide.
- Weigh the body, not the subject. Marketing lines like "Quick question?" or "Following up" are designed to look personal. A real ask names something specific.
- Automated mail is never "reply", however urgently it is phrased. No-reply addresses, notification bots, and system alerts cannot receive an answer.
- If Chris is CC'd and the ask is clearly directed at someone else, that is "read", not "reply".
- Cold outreach that opens with flattery is still cold outreach. Judge it by whether there is an existing relationship, not by how personal the tone is.
- Real people beat everything. When torn between "reply" and "read" for a human who is plausibly a client, a bandmate, a venue, a collaborator, or a friend, choose "reply" — a missed real email costs him far more than an extra item on a list.
- Never file a human being's personal message as "junk" because it is not business. On a personal or mixed mailbox, a friend or family member writing to him is the mail that matters most.
- When torn between "unsubscribe" and "junk", prefer "unsubscribe". It is the reversible, lower-stakes call.

Write "reason" as one short, concrete sentence naming the actual thing in the email — "Asking to move Thursday's shoot to Friday", not "Requires a response". Chris reads the reason to decide whether to trust you, so a vague reason is a useless one.`

const SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'integer', description: 'The [n] ref of the email being judged' },
          action: { type: 'string', enum: ['reply', 'read', 'unsubscribe', 'junk'] },
          reason: { type: 'string', description: 'One short sentence naming the specific thing in the email' },
        },
        required: ['ref', 'action', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
}

async function classify(anthropic: Anthropic, batch: any[], accounts: any[]) {
  const rendered = batch.map((m, i) => [
    `[${i}]`,
    `From: ${m.sender} <${m.sender_email}>`,
    `To (this mailbox): ${m.account_email}`,
    `Subject: ${m.subject || '(no subject)'}`,
    m.unsubscribe_url ? 'Has unsubscribe link: yes' : '',
    `Body: ${m.body || m.snippet || '(empty)'}`,
  ].filter(Boolean).join('\n')).join('\n\n---\n\n')

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: buildSystem(accounts) + RUBRIC,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: `Sort these ${batch.length} emails. Return one verdict per email, using the [n] ref.\n\n${rendered}`,
    }],
  })

  // output_config guarantees the first text block is valid JSON matching SCHEMA.
  const text = res.content.find((b: any) => b.type === 'text')?.text ?? '{"verdicts":[]}'
  return JSON.parse(text).verdicts as { ref: number; action: string; reason: string }[]
}

/* ---------- handler ---------- */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!)
  const { data: u, error: uErr } = await admin.auth.getUser(jwt)
  if (uErr || !u?.user) return json({ error: 'unauthorized' }, 401)
  const userId = u.user.id

  if (!ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY is not set on this function' }, 500)
  }

  // `purpose` is Chris's own description of each mailbox — it goes straight into
  // the prompt and is what lets the same email be urgent here and junk there.
  const { data: accounts } = await admin
    .from('connected_accounts')
    .select('id, email, purpose')
    .eq('user_id', userId)
    .eq('provider', 'google')

  if (!accounts?.length) return json({ emails: [], remaining: 0, classified: 0 })

  // 1. What's in the inboxes right now (ids only — one cheap call per mailbox).
  const seen: { id: string; account: any }[] = []
  const accountErrors: string[] = []
  for (const acct of accounts) {
    const token = await freshAccessToken(admin, acct)
    if (!token) { accountErrors.push(`${acct.email}: token refresh failed`); continue }

    const params = new URLSearchParams({
      q: 'in:inbox newer_than:7d',
      maxResults: String(LIST_PER_ACCOUNT),
    })
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!r.ok) {
      // Almost always "insufficient scope" — the account was connected before
      // Gmail was added and needs reconnecting. Say so instead of showing zero.
      const detail = r.status === 403 ? 'needs reconnect (no Gmail permission)' : `HTTP ${r.status}`
      accountErrors.push(`${acct.email}: ${detail}`)
      continue
    }
    const j = await r.json()
    for (const m of j.messages ?? []) seen.push({ id: m.id, account: { ...acct, token } })
  }

  // 2. Which of those has Claude already judged?
  //
  // Filtered by date rather than .in(ids): six mailboxes x LIST_PER_ACCOUNT is
  // hundreds of ids, and PostgREST takes them as a query string — that URL runs
  // to ~10KB and gets rejected. It would have worked fine on one account and
  // broken on the sixth. The window matches the Gmail query above, so the row
  // count stays small either way.
  const { data: known } = await admin
    .from('email_verdicts')
    .select('message_id, account_email')
    .eq('user_id', userId)
    .gte('received_at', new Date(Date.now() - 8 * 86_400_000).toISOString())

  // Keyed by mailbox too — Gmail ids are only unique within one mailbox.
  const key = (accountEmail: string, id: string) => `${accountEmail} ${id}`
  const knownIds = new Set((known ?? []).map((k: any) => key(k.account_email, k.message_id)))
  const todo = seen.filter((s) => !knownIds.has(key(s.account.email, s.id)))
  const batchIds = todo.slice(0, MAX_PER_RUN)

  // 3. Fetch full bodies for just this batch, in parallel.
  const batch = (await Promise.all(batchIds.map(async ({ id, account }) => {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: { Authorization: `Bearer ${account.token}` } },
    )
    if (!r.ok) return null
    const m = await r.json()
    const headers = m.payload?.headers ?? []
    const from = parseFrom(header(headers, 'From'))
    const unsub = unsubscribeInfo(headers)
    return {
      user_id: userId,
      message_id: m.id,
      thread_id: m.threadId,
      account_email: account.email,
      sender: from.name,
      sender_email: from.email,
      subject: header(headers, 'Subject'),
      snippet: m.snippet ?? '',
      received_at: m.internalDate
        ? new Date(Number(m.internalDate)).toISOString()
        : new Date().toISOString(),
      unsubscribe_url: unsub.url,
      body: extractBody(m.payload),   // dropped before insert — prompt only
    }
  }))).filter(Boolean) as any[]

  // 4. One Claude call for the whole batch.
  let classified = 0
  if (batch.length) {
    try {
      const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
      const verdicts = await classify(anthropic, batch, accounts)
      const byRef = new Map(verdicts.map((v) => [v.ref, v]))

      const rows = batch.map((m, i) => {
        const v = byRef.get(i)
        const { body: _body, ...rest } = m
        return {
          ...rest,
          // A message Claude didn't return a verdict for shouldn't vanish —
          // park it in "read" so it's visible and obviously unjudged.
          action: v?.action ?? 'read',
          reason: v?.reason ?? 'Not classified',
          model: MODEL,
          classified_at: new Date().toISOString(),
        }
      })
      const { error } = await admin
        .from('email_verdicts')
        .upsert(rows, { onConflict: 'user_id,account_email,message_id' })
      if (error) return json({ error: `Saving verdicts failed: ${error.message}` }, 500)
      classified = rows.length
    } catch (e) {
      return json({ error: `Claude classification failed: ${String((e as Error).message)}` }, 502)
    }
  }

  // 5. Hand back the whole unhandled inbox, freshly judged bits included.
  const { data: emails } = await admin
    .from('email_verdicts')
    .select('*')
    .eq('user_id', userId)
    .is('handled_at', null)
    .order('received_at', { ascending: false })
    .limit(200)

  return json({
    emails: emails ?? [],
    classified,
    remaining: Math.max(0, todo.length - batchIds.length),
    accountErrors,
  })
})
