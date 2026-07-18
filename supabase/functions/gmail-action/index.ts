// Sentinel — act on one email, because Chris clicked something.
//
// Deploy with "Verify JWT" ON. Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
//
// This is the only code in Sentinel that mutates a mailbox, so it is
// deliberately small and deliberately dumb: it takes one message id and one of
// three verbs, and it never decides anything. Claude's verdict lives in
// email_verdicts and is a suggestion; nothing here reads it.
//
//   read        — remove the UNREAD label
//   trash       — move to Trash. Recoverable in Gmail for 30 days. There is no
//                 permanent-delete verb on purpose: that needs Google's widest
//                 mail scope, and Sentinel should not hold it.
//   unsubscribe — POST the sender's RFC 8058 one-click endpoint, then trash.
//
// Replying is not here. Sending mail as Chris is a bigger decision than triage
// and deserves its own consent; the app deep-links to Gmail instead.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!)
  const { data: u, error: uErr } = await admin.auth.getUser(jwt)
  if (uErr || !u?.user) return json({ error: 'unauthorized' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* no body */ }
  // accountEmail is required, not optional: Gmail message ids are unique per
  // mailbox, so an id alone doesn't identify a message across six accounts.
  const { messageId, accountEmail, action } = body
  const ACTIONS = ['read', 'trash', 'unsubscribe', 'star', 'unstar', 'unread', 'untrash']
  if (!messageId || !accountEmail || !ACTIONS.includes(action)) {
    return json({ error: `Expected { messageId, accountEmail, action: ${ACTIONS.join('|')} }` }, 400)
  }

  // Read the row through the *user's* id, so one person can never act on
  // another's mail by guessing a Gmail message id.
  const { data: row } = await admin
    .from('email_verdicts')
    .select('message_id, account_email, unsubscribe_url')
    .eq('user_id', u.user.id)
    .eq('account_email', accountEmail)
    .eq('message_id', messageId)
    .single()
  if (!row) return json({ error: 'No such message' }, 404)

  const { data: acct } = await admin
    .from('connected_accounts')
    .select('id, email')
    .eq('user_id', u.user.id)
    .eq('email', row.account_email)
    .single()
  if (!acct) {
    return json(
      { error: 'account_not_connected', account: row.account_email,
        message: `${row.account_email} is no longer connected. Reconnect it in Settings to act on its mail.` },
      409,
    )
  }

  const token = await freshAccessToken(admin, acct)
  if (!token) {
    return json(
      { error: 'account_needs_reconnect', account: acct.email,
        message: `${acct.email} needs to be reconnected in Settings — its access has expired.` },
      502,
    )
  }
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const base = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`

  // Flag = Gmail's star. Toggle the STARRED label and mirror it in our row.
  // Unlike the other actions, this is NOT terminal: a starred email stays in
  // the list, so we never set handled_at here.
  if (action === 'star' || action === 'unstar') {
    const starred = action === 'star'
    const r = await fetch(`${base}/modify`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(starred ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] }),
    })
    if (!r.ok) return json({ error: `Gmail refused the star request (HTTP ${r.status})` }, 502)

    await admin
      .from('email_verdicts')
      .update({ flagged: starred })
      .eq('user_id', u.user.id)
      .eq('account_email', accountEmail)
      .eq('message_id', messageId)

    return json({ ok: true, action, flagged: starred })
  }

  // Undo for mark-read / trash: reverse the Gmail change and un-handle the row
  // so it returns to the list. Not terminal — no handled_at set (we clear it).
  if (action === 'unread' || action === 'untrash') {
    const r = action === 'unread'
      ? await fetch(`${base}/modify`, {
          method: 'POST', headers: auth,
          body: JSON.stringify({ addLabelIds: ['UNREAD'] }),
        })
      : await fetch(`${base}/untrash`, { method: 'POST', headers: auth })
    if (!r.ok) return json({ error: `Gmail refused the undo (HTTP ${r.status})` }, 502)

    await admin
      .from('email_verdicts')
      .update({ handled_at: null })
      .eq('user_id', u.user.id)
      .eq('account_email', accountEmail)
      .eq('message_id', messageId)

    return json({ ok: true, action })
  }

  let note: string | null = null

  if (action === 'unsubscribe') {
    // One-click only. If the sender didn't give us an RFC 8058 endpoint we do
    // NOT go hunting for a link in the body — the app opens their page in a tab
    // and Chris finishes it himself.
    if (!row.unsubscribe_url) {
      return json({ error: 'no_one_click', message: 'This sender has no one-click unsubscribe.' }, 422)
    }
    try {
      const r = await fetch(row.unsubscribe_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      })
      note = r.ok ? 'Unsubscribe request sent' : `Sender returned HTTP ${r.status}`
    } catch (e) {
      note = `Unsubscribe request failed: ${(e as Error).message}`
    }
  }

  // Unsubscribing also clears it out — the point is to stop seeing this sender.
  if (action === 'trash' || action === 'unsubscribe') {
    const r = await fetch(`${base}/trash`, { method: 'POST', headers: auth })
    if (!r.ok) return json({ error: `Gmail refused the trash request (HTTP ${r.status})` }, 502)
  } else if (action === 'read') {
    const r = await fetch(`${base}/modify`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    })
    if (!r.ok) return json({ error: `Gmail refused the modify request (HTTP ${r.status})` }, 502)
  }

  await admin
    .from('email_verdicts')
    .update({ handled_at: new Date().toISOString() })
    .eq('user_id', u.user.id)
    .eq('account_email', accountEmail)
    .eq('message_id', messageId)

  return json({ ok: true, action, note })
})
