/* A brief "Undo" bar after a reversible mail action (mark-read / trash), like
   Gmail's. Sits above the safe area so it clears the iPhone home indicator. */
export default function UndoToast({ undoable, onUndo, onDismiss }) {
  if (!undoable) return null

  return (
    <div
      className="fixed left-0 right-0 z-50 flex justify-center px-4 pointer-events-none"
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
    >
      <div className="pointer-events-auto flex items-center gap-4 bg-surface2 border border-line2 rounded-xl shadow-xl px-4 py-2.5 max-w-sm w-full sm:w-auto">
        <span className="text-sm text-fg flex-1 min-w-0 truncate">{undoable.label}</span>
        <button
          onClick={onUndo}
          className="text-sm font-medium text-fg underline underline-offset-2 hover:opacity-80 transition-opacity shrink-0"
        >
          Undo
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-faint hover:text-fg transition-colors shrink-0 text-sm"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
