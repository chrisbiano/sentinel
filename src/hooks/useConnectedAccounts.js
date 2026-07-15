import { useState, useEffect, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

/* Connected mailboxes (metadata only — tokens live server-side and are
   unreadable from the browser by design). */
export default function useConnectedAccounts() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(isSupabaseConfigured)

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    const { data, error } = await supabase
      .from('connected_accounts')
      .select('id, email, provider, status, created_at')
      .order('created_at', { ascending: true })
    if (error) console.error('Load connected accounts failed:', error)
    setAccounts(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Deleting the account cascades to its tokens (ON DELETE CASCADE).
  const disconnect = useCallback(async (id) => {
    setAccounts(prev => prev.filter(a => a.id !== id))
    const { error } = await supabase.from('connected_accounts').delete().eq('id', id)
    if (error) {
      console.error('Disconnect failed:', error)
      refresh()
    }
  }, [refresh])

  return { accounts, loading, refresh, disconnect }
}
