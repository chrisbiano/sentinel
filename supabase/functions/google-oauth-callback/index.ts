// Sentinel — Google OAuth callback for connecting Gmail/Calendar accounts.
// Deploy with "Verify JWT" OFF: Google's redirect carries no Supabase login
// token, so this endpoint must be publicly reachable. It authenticates the
// user via the access token packed into the OAuth `state` instead.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-oauth-callback`
const FALLBACK_APP = 'https://sentinel-pied-sigma.vercel.app'

function decodeState(raw: string): { token: string; origin: string } {
  try {
    const json = JSON.parse(atob(raw))
    return { token: json.t, origin: json.o || FALLBACK_APP }
  } catch {
    return { token: raw, origin: FALLBACK_APP }
  }
}

function back(origin: string, params: Record<string, string>) {
  const u = new URL(origin)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return Response.redirect(u.toString(), 302)
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const oauthErr = url.searchParams.get('error')
  const { token, origin } = decodeState(url.searchParams.get('state') || '')

  if (oauthErr) return back(origin, { connect_error: oauthErr })
  if (!code || !token) return back(origin, { connect_error: 'missing_params' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Identify the Sentinel user from the access token passed in `state`.
  const { data: u, error: uErr } = await admin.auth.getUser(token)
  if (uErr || !u?.user) return back(origin, { connect_error: 'auth' })
  const userId = u.user.id

  // Exchange the authorization code for tokens (offline => refresh_token).
  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  const tok = await tokRes.json()
  if (!tokRes.ok || !tok.refresh_token) {
    return back(origin, { connect_error: 'token_exchange' })
  }

  // Which Google account did they connect?
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  })
  const info = await infoRes.json()
  if (!info.email) return back(origin, { connect_error: 'no_email' })

  // Save mailbox metadata (browser-readable via RLS) ...
  const { data: acct, error: aErr } = await admin
    .from('connected_accounts')
    .upsert(
      { user_id: userId, provider: 'google', email: info.email, status: 'connected' },
      { onConflict: 'user_id,email' },
    )
    .select()
    .single()
  if (aErr || !acct) return back(origin, { connect_error: 'save_account' })

  // ... and its tokens (locked to the service role only).
  const expiresAt = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString()
  const { error: tErr } = await admin.from('account_tokens').upsert({
    account_id: acct.id,
    refresh_token: tok.refresh_token,
    access_token: tok.access_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  })
  if (tErr) return back(origin, { connect_error: 'save_token' })

  return back(origin, { connected: info.email })
})
