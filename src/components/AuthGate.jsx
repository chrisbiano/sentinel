import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import Login from './Login'

/* Gates the app behind Google sign-in when Supabase is configured.
   Without env vars, falls through to the app (local-only mode). */
export default function AuthGate({ children }) {
  // undefined = still checking; null = signed out; object = signed in.
  const [session, setSession] = useState(isSupabaseConfigured ? undefined : null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!isSupabaseConfigured) return children

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-bg text-muted flex items-center justify-center text-sm">
        Loading…
      </div>
    )
  }

  if (!session) return <Login />

  return children
}
