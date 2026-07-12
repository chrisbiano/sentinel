export default function SectionHeader({ icon, title, count, action }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-surface2 border border-line text-muted">
        {icon}
      </span>
      <h2 className="section-title">{title}</h2>
      <div className="ml-auto flex items-center gap-2">
        {count != null && (
          <span className="text-xs font-medium text-muted bg-surface2 border border-line px-2.5 py-1 rounded-full tabular-nums">
            {count}
          </span>
        )}
        {action}
      </div>
    </div>
  )
}
