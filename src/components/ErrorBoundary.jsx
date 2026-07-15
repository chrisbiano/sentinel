import { Component } from 'react'

/* Catches render errors in any child so one broken component shows a
   recoverable fallback instead of white-screening the whole app. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Sentinel caught a render error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-bg text-fg flex items-center justify-center p-6">
          <div className="card max-w-lg w-full text-center">
            <h1 className="text-lg font-medium mb-2">Something went wrong</h1>
            <p className="text-muted text-sm mb-4">
              Sentinel hit an unexpected error. Your saved data is safe.
            </p>
            {/* Show the actual message — a generic apology helps nobody debug. */}
            <p className="text-xs text-muted text-left bg-surface2 border border-line rounded-lg p-3 mb-4 font-mono break-words">
              {String(this.state.error?.message || this.state.error)}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 bg-accent text-accent-fg rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
