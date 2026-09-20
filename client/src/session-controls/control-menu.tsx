import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  value: string
  label: string
  detail?: string
  chosen: boolean
}

interface ControlMenuProperties {
  label: string
  title: string
  tone: 'muted' | 'keel' | 'hold'
  items: readonly MenuItem[]
  onPick: (value: string) => void
}

const toneClasses = {
  muted: 'text-muted-foreground',
  keel: 'text-keel',
  hold: 'text-hold',
}

/**
 * One segment of the status line, with the choices it can be changed to.
 *
 * The list opens upwards because the status line sits at the bottom of the
 * column, and it closes on Escape, on an outside click and on a choice.
 */
export function ControlMenu({ label, title, tone, items, onPick }: ControlMenuProperties) {
  const [open, setOpen] = useState(false)
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const dismiss = (event: MouseEvent) => {
      if (!frame.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={frame} className="relative">
      <button
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`rounded-sm px-1.5 py-0.5 hover:bg-foreground/5 hover:text-foreground focus-visible:ring-1 focus-visible:ring-keel focus-visible:outline-none ${toneClasses[tone]}`}
      >
        {label}
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 z-10 mb-1 max-h-72 w-64 overflow-y-auto rounded-sm border border-border bg-popover py-1 shadow-sm"
        >
          {items.map((item) => (
            <li key={item.value}>
              <button
                type="button"
                role="option"
                aria-selected={item.chosen}
                onClick={() => {
                  setOpen(false)
                  onPick(item.value)
                }}
                className={`block w-full px-3 py-1.5 text-left hover:bg-foreground/5 ${
                  item.chosen ? 'text-keel' : 'text-foreground'
                }`}
              >
                <span className="block">{item.label}</span>
                {item.detail !== undefined && (
                  <span className="block text-muted-foreground">{item.detail}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
