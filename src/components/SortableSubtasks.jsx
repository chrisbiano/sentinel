import { useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
    </svg>
  )
}

// One subtask: grip handle to drag, checkbox to toggle, click the text to
// rename (a 3-line box, easier to read/edit long titles), × to remove (events only).
function Row({ s, onToggle, onRemove, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(s.title)

  const save = () => {
    const t = draft.trim()
    if (t && t !== s.title) onEdit(s.id, t)
    setEditing(false)
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <li ref={setNodeRef} style={style} className={`flex gap-1.5 group ${editing ? 'items-start' : 'items-center'}`}>
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className={`text-faint hover:text-muted cursor-grab active:cursor-grabbing touch-none shrink-0 ${editing ? 'mt-1.5' : ''}`}
      >
        <GripIcon />
      </button>
      <input
        type="checkbox"
        checked={s.done}
        onChange={() => onToggle(s.id)}
        className={`w-3.5 h-3.5 rounded bg-surface2 border-line2 text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer shrink-0 ${editing ? 'mt-1.5' : ''}`}
      />
      {editing ? (
        <textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => {
            // Enter saves (these are one-line titles); Shift+Enter for a newline.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() }
            if (e.key === 'Escape') setEditing(false)
          }}
          // min-w-0 + w-0 lets the box shrink to the column instead of running
          // off the right edge of the phone; the 3 rows give room to read.
          className="input flex-1 min-w-0 w-0 py-1 text-xs resize-none leading-snug"
        />
      ) : (
        <span
          onClick={() => { setDraft(s.title); setEditing(true) }}
          title="Tap to edit"
          className={`text-xs flex-1 min-w-0 break-words cursor-text ${s.done ? 'line-through text-faint' : 'text-muted'}`}
        >
          {s.title}
        </span>
      )}
      {onRemove && (
        <button
          onClick={() => onRemove(s.id)}
          aria-label="Remove subtask"
          className="text-faint hover:text-fg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-xs shrink-0"
        >
          ×
        </button>
      )}
    </li>
  )
}

/* A subtask list you can reorder by dragging the grip handle (hold and move —
   works on touch), toggle, rename by double-clicking, and (for events) remove.
   onReorder / onEdit hand back the *new full array* / (id, title) to persist. */
export default function SortableSubtasks({ subtasks, onToggle, onRemove, onEdit, onReorder }) {
  // Distance/delay activation so a tap or double-click on the text doesn't start
  // a drag — only a deliberate press-and-move on the grip does.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  )

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    const from = subtasks.findIndex(s => s.id === active.id)
    const to = subtasks.findIndex(s => s.id === over.id)
    if (from !== -1 && to !== -1) onReorder(arrayMove(subtasks, from, to))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={subtasks.map(s => s.id)} strategy={verticalListSortingStrategy}>
        <ul className="mt-2.5 space-y-1.5">
          {subtasks.map(s => (
            <Row key={s.id} s={s} onToggle={onToggle} onRemove={onRemove} onEdit={onEdit} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
