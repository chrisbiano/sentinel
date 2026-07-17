// Sentinel — autocomplete addresses for forwarding, from the people you've
// emailed on a given account (Google People API "other contacts").
//
// Deploy with "Verify JWT" ON. Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
// Requires the contacts.other.readonly scope (see connect.js) — reconnect the
// account after adding it. Read-only: this only searches contacts, never edits.
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

// otherContacts.search wants a "warmup" (an empty-query call) to prime its
// index before the first real search returns results.
async function searchOtherContacts(token: string, query: string) {
  const base = 'https://people.googleapis.com/v1/otherContacts:search'
  const params = (q: string) => new URLSearchParams({ query: q, readMask: 'names,emailAddresses', pageSize: '20' })
  const call = (q: string) => fetch(`${base}?${params(q)}`, { headers: { Authorization: `Bearer ${token}` } })

  let r = await call(query)
  if (r.status === 400) {                 // cold index → warm it, then retry once
    await call('')
    await new Promise((res) => setTimeout(res, 300))
    r = await call(query)
  }
  if (!r.ok) return { ok: false, status: r.status }
  const j = await r.json()

  const out: { name: string; email: string }[] = []
  const seen = new Set<string>()
  for (const res of j.results ?? []) {
    const person = res.person ?? {}
    const name = person.names?.[0]?.displayName ?? ''
    for (const e of person.emailAddresses ?? []) {
      const email = (e.value ?? '').toLowerCase()
      if (email && !seen.has(email)) {
        seen.add(email)
        out.push({ name: name || email, email })
      }
    }
  }
  return { ok: true, contacts: out }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!)
  const { data: u, error: uErr } = await admin.auth.getUser(jwt)
  if (uErr || !u?.user) return json({ error: 'unauthorized' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* none */ }
  const { accountEmail, query } = body
  if (!accountEmail || typeof query !== 'string') {
    return json({ error: 'Expected { accountEmail, query }' }, 400)
  }
  if (query.trim().length < 2) return json({ contacts: [] })   // don't search on 1 char

  const { data: acct } = await admin
    .from('connected_accounts')
    .select('id, email')
    .eq('user_id', u.user.id)
    .eq('email', accountEmail)
    .single()
  if (!acct) return json({ error: `${accountEmail} is no longer connected` }, 409)

  const token = await freshAccessToken(admin, acct)
  if (!token) return json({ error: `Couldn't refresh access for ${accountEmail}` }, 502)

  const res = await searchOtherContacts(token, query.trim())
  if (!res.ok) {
    // 403 = the account hasn't granted contacts access yet (needs reconnect).
    const detail = res.status === 403 ? 'no contacts permission — reconnect this account' : `People API error (HTTP ${res.status})`
    return json({ error: detail, contacts: [] }, 200)   // soft-fail: the field still works, just no suggestions
  }
  return json({ contacts: res.contacts })
})
