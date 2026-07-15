const views = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

export default function ViewSwitcher({ value, onChange }) {
  return (
    <div className="flex bg-bg border border-line rounded-lg p-0.5">
      {views.map(v => (
        <button
          key={v.value}
          onClick={() => onChange(v.value)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            value === v.value ? 'bg-surface2 text-fg' : 'text-muted hover:text-fg'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}
