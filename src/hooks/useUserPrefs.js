import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

/* Per-user scheduling prefs the server needs: the browser's timezone (so the
   morning brief lands at 7am the user's time, not UTC) and whether they want it.
   The timezone is synced on every load; the toggle lives in Settings. */
export default function useUserPrefs() {
  const [morningBrief, setMorningBriefState] = useState(true)
  const userIdRef = useRef(null)
  const started = useRef(false)

  useEffect(() => {
    if (!isSupabaseConfigured || started.current) return
    started.current = true
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        userIdRef.current = user.id
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        // Create the row if missing, keep the timezone current (upsert only
        // touches the columns we pass, so morning_brief keeps its value/default).
        await supabase.from('user_prefs').upsert(
          { user_id: user.id, timezone: tz, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        )
        const { data } = await supabase
          .from('user_prefs').select('morning_brief').eq('user_id', user.id).single()
        if (data) setMorningBriefState(data.morning_brief)
      } catch (e) {
        console.error('user prefs sync failed:', e)
      }
    })()
  }, [])

  const setMorningBrief = useCallback((on) => {
    setMorningBriefState(on)
    if (isSupabaseConfigured && userIdRef.current) {
      supabase.from('user_prefs').upsert(
        {
          user_id: userIdRef.current,
          morning_brief: on,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      ).then(({ error }) => { if (error) console.error('pref save failed:', error) })
    }
  }, [])

  return { morningBrief, setMorningBrief }
}
