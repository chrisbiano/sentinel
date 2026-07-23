function RefreshIcon({ spinning }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

export default function Layout({ children, onOpenSettings, onRefresh, refreshing }) {
  return (
    <div
      className="min-h-screen bg-bg"
      // Respect the notch in landscape; zero on desktop and in portrait.
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {/* Header — pad down by the iOS status-bar height so the title clears the
          clock/battery when installed as a home-screen app. The sticky bar's
          background still fills up to the top edge. */}
      <header
        className="sticky top-0 z-10 bg-bg/80 backdrop-blur border-b border-line"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center gap-4">
            <div>
              <h1 className="text-lg sm:text-xl font-medium tracking-tight text-fg">Sentyra</h1>
              <p className="text-muted text-xs sm:text-sm">Your daily command center</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Pull fresh calendar data on demand — an event just edited in
                  Google shouldn't have to wait for the next natural sync. */}
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  disabled={refreshing}
                  aria-label="Refresh calendar"
                  title="Refresh calendar"
                  className="w-9 h-9 flex items-center justify-center bg-transparent border border-line2 text-fg rounded-lg hover:bg-surface2 transition-colors disabled:opacity-60"
                >
                  <RefreshIcon spinning={refreshing} />
                </button>
              )}
              <button
                onClick={onOpenSettings}
                className="px-4 py-2 bg-transparent border border-line2 text-fg rounded-lg font-medium text-sm hover:bg-surface2 transition-colors"
              >
                Settings
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {children}
      </div>

      {/* Footer — pad past the home-indicator bar at the bottom of the screen. */}
      <footer
        className="border-t border-line mt-12"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-faint text-sm text-center">
            Sentyra · Keeping you on track, always
          </p>
        </div>
      </footer>
    </div>
  )
}
