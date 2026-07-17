import { supabase } from './supabase'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export const isConnectConfigured = Boolean(CLIENT_ID && SUPABASE_URL)

/* Calendar stays read-only — Sentinel annotates blocks in its own store and
   never writes back to Google.
 *
 * Gmail scopes, each earning its place:
 *   modify        — triage is useless if you can't act on it: mark read, move
 *                   to Trash. Notably cannot permanently delete (that needs
 *                   Google's blanket mail scope, which we refuse); trashed mail
 *                   is recoverable in Gmail for 30 days.
 *   send          — reply to a message in-thread, as you.
 *   settings.basic — read the account's real send-as signature so replies go
 *                   out with it intact. Read-only use; we never change settings.
 *   contacts.other.readonly — power the "type a name, pick from a list" address
 *                   autocomplete when forwarding, from the people you've emailed
 *                   (Gmail's "other contacts"). Read-only; we never edit contacts.
 *
 * Changing this list means every already-connected account must reconnect to
 * re-consent. `include_granted_scopes` keeps previously granted access intact. */
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/contacts.other.readonly',
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
