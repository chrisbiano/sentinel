import { supabase } from './supabase'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export const isConnectConfigured = Boolean(CLIENT_ID && SUPABASE_URL)

// Read-only Calendar for now; Gmail scope gets added when we wire mail.
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')

/**
 * Kick off the "connect a mailbox" flow. Sends the browser to Google, which
 * redirects to our Edge Function, which stores the tokens and bounces back here.
 * `state` carries the user's access token (so the function knows who's
 * connecting) plus this origin (so it returns to localhost or prod correctly).
 */
export async function startGoogleConnect() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const state = btoa(JSON.stringify({
    t: session.access_token,
    o: window.location.origin,
  }))

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `${SUPABASE_URL}/functions/v1/google-oauth-callback`,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',        // ask for a refresh token
    prompt: 'consent select_account', // always let them pick which account
    include_granted_scopes: 'true',
    state,
  })

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}
