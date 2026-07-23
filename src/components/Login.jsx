import { useState } from 'react'
import { supabase } from '../lib/supabase'

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.6-2.5C16.9 3.4 14.7 2.4 12 2.4 6.9 2.4 2.8 6.5 2.8 11.6S6.9 20.8 12 20.8c5.3 0 8.8-3.7 8.8-9 0-.6-.06-1-.15-1.6H12z" />
    </svg>
  )
}

export default function Login() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const signIn = async () => {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // On success the browser redirects to Google, so no further state needed.
  }

  return (
    <div className="min-h-screen bg-bg text-fg flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-fg/70" />
          <span className="text-sm font-medium tracking-[0.14em] uppercase">Sentyra</span>
        </div>
        <h1 className="text-xl font-medium tracking-tight mb-1">Your daily command center</h1>
        <p className="text-muted text-sm mb-8">Sign in to see your day.</p>

        <button
          onClick={signIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 bg-accent text-accent-fg rounded-lg font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <GoogleGlyph />
          {loading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {error && (
          <p className="text-sm mt-4 text-muted border border-line2 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <p className="text-faint text-xs mt-8">
          Sentyra only reads what you allow, and your data stays yours.
        </p>
      </div>
    </div>
  )
}
