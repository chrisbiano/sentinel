export default function Layout({ children, onOpenSettings }) {
  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-bg/80 backdrop-blur border-b border-line">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center gap-4">
            <div>
              <h1 className="text-lg sm:text-xl font-medium tracking-tight text-fg">Sentinel</h1>
              <p className="text-muted text-xs sm:text-sm">Your daily command center</p>
            </div>
            <button
              onClick={onOpenSettings}
              className="px-4 py-2 bg-transparent border border-line2 text-fg rounded-lg font-medium text-sm hover:bg-surface2 transition-colors shrink-0"
            >
              Settings
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {children}
      </div>

      {/* Footer */}
      <footer className="border-t border-line mt-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-faint text-sm text-center">
            Sentinel · Keeping you on track, always
          </p>
        </div>
      </footer>
    </div>
  )
}
