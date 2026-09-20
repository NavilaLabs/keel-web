import type { Completion } from './types.ts'

interface CompletionListProperties {
  items: readonly Completion[]
  /** The row the arrow keys have reached, or -1 while none has been chosen. */
  highlighted: number
  listId: string
  onTake: (item: Completion) => void
  onHighlight: (at: number) => void
}

/**
 * The completions, drawn above the input.
 *
 * It is a listbox the input owns rather than a control of its own: it never
 * takes the focus, so what is typed keeps going into the message while it is
 * open. The input names the highlighted row through `aria-activedescendant`.
 */
export function CompletionList({
  items,
  highlighted,
  listId,
  onTake,
  onHighlight,
}: CompletionListProperties) {
  if (items.length === 0) return null

  return (
    <ul
      id={listId}
      role="listbox"
      className="absolute bottom-full left-0 z-10 mb-1 max-h-72 w-full overflow-y-auto rounded-sm border border-border bg-popover py-1 shadow-sm"
    >
      {items.map((item, at) => (
        <li key={item.key}>
          <button
            type="button"
            role="option"
            id={`${listId}-${at}`}
            aria-selected={at === highlighted}
            // The input keeps the focus, so the click must not move it there.
            onMouseDown={(pressed) => pressed.preventDefault()}
            onMouseEnter={() => onHighlight(at)}
            onClick={() => onTake(item)}
            className={`block w-full px-3 py-1.5 text-left text-[13px] ${
              at === highlighted ? 'bg-foreground/5 text-foreground' : 'text-muted-foreground'
            }`}
          >
            <span className="block font-mono text-foreground">{item.label}</span>
            {item.detail !== undefined && <span className="block">{item.detail}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}
