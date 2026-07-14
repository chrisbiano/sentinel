import { createClient } from '@supabase/supabase-js'

// These are public by design (protected by row-level security), so the
// VITE_ prefix is safe here — see .env.example.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// When the env vars aren't set, Sentinel runs in local-only mode (no auth,
// tasks in localStorage) so the app still works before the backend is wired.
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null
