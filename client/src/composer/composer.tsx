import type { FileEntry, FileMatches } from '@keel-web/protocol'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CompletionList } from './completion-list.tsx'
import { commandCompletions, completionsOfFiles } from './completions.ts'
import { findTrigger } from './find-trigger.ts'
import type { Completion, ComposerProperties } from './types.ts'

const listId = 'composer-completions'

function isWalkable(text: string, caret: number): boolean {
  return !text.slice(0, caret).includes('\n')
}

/**
 * The message input.
 *
 * It holds the draft of one session, so the chat surface gives it a key of
 * that session: switching tickets makes a new one rather than telling this
 * one to forget everything it was holding.
 */
export function Composer({ session, commands, drafts, onSend, onCycleMode }: ComposerProperties) {
  const [text, setText] = useState(() => (session === undefined ? '' : drafts.readDraft(session)))
  const [caret, setCaret] = useState(0)
  const [entries, setEntries] = useState<readonly FileEntry[]>([])
  const [highlighted, setHighlighted] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const [back, setBack] = useState(0)

  const input = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | undefined>(undefined)
  // What was being written before the walk into the history started.
  const unsent = useRef('')

  const workspaceId = session?.workspaceId
  const ticketId = session?.ticketId

  const trigger = dismissed ? undefined : findTrigger(text, caret)
  const triggerKind = trigger?.kind
  const triggerQuery = trigger?.query

  useEffect(() => {
    if (workspaceId === undefined || ticketId === undefined) return
    drafts.writeDraft({ workspaceId, ticketId }, text)
  }, [text, workspaceId, ticketId, drafts])

  // What was found last stays held while the next answer is on its way, so
  // the popup keeps showing something rather than blinking between
  // keystrokes. Which trigger it belongs to is decided below, when the rows
  // are built.
  useEffect(() => {
    if (workspaceId === undefined || triggerKind !== 'file') return undefined

    // Every keystroke asks again, so the answer to the one before it is
    // dropped rather than raced.
    const abort = new AbortController()
    const asked = `query=${encodeURIComponent(triggerQuery ?? '')}`
    void (async () => {
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/files?${asked}`,
          { signal: abort.signal },
        )
        if (!response.ok) return
        setEntries(((await response.json()) as FileMatches).entries)
      } catch {
        // A newer keystroke aborted this one, or the server went away. Either
        // way the popup shows what it already had.
      }
    })()
    return () => abort.abort()
  }, [workspaceId, triggerKind, triggerQuery])

  const items = useMemo(() => {
    if (triggerKind === 'command') return commandCompletions(commands, triggerQuery ?? '')
    return triggerKind === 'file' ? completionsOfFiles(entries) : []
  }, [triggerKind, triggerQuery, commands, entries])

  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at === undefined) return
    pendingCaret.current = undefined
    input.current?.setSelectionRange(at, at)
    setCaret(at)
  }, [text])

  const rewrite = (next: string, nextCaret: number) => {
    setText(next)
    setCaret(nextCaret)
    setDismissed(false)
    setHighlighted(-1)
  }

  const take = (item: Completion) => {
    if (trigger === undefined) return
    pendingCaret.current = trigger.at + item.insert.length
    setText(text.slice(0, trigger.at) + item.insert + text.slice(caret))
    setHighlighted(-1)
  }

  const submit = () => {
    const message = text.trim()
    if (message === '' || workspaceId === undefined || ticketId === undefined) return
    drafts.recordSent({ workspaceId, ticketId }, message)
    setText('')
    setCaret(0)
    setBack(0)
    setHighlighted(-1)
    setDismissed(false)
    onSend(message)
  }

  const walk = (steps: number): boolean => {
    if (workspaceId === undefined) return false
    const next = back + steps
    if (next < 0) return false
    if (next === 0) {
      setBack(0)
      setText(unsent.current)
      return true
    }
    const earlier = drafts.earlier(workspaceId, next)
    if (earlier === undefined) return false
    if (back === 0) unsent.current = text
    setBack(next)
    setText(earlier)
    return true
  }

  const open = items.length > 0

  const handleKey = (pressed: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (pressed.key === 'Tab' && pressed.shiftKey) {
      pressed.preventDefault()
      onCycleMode()
      return
    }
    if (pressed.key === 'Tab' && open) {
      pressed.preventDefault()
      take(items[Math.max(highlighted, 0)] as Completion)
      return
    }
    if (pressed.key === 'Escape' && open) {
      pressed.preventDefault()
      setDismissed(true)
      setHighlighted(-1)
      return
    }
    if (pressed.key === 'ArrowDown' && open) {
      pressed.preventDefault()
      setHighlighted(Math.min(highlighted + 1, items.length - 1))
      return
    }
    if (pressed.key === 'ArrowUp' && open) {
      pressed.preventDefault()
      setHighlighted(highlighted <= 0 ? -1 : highlighted - 1)
      return
    }
    if (pressed.key === 'Enter' && !pressed.shiftKey) {
      pressed.preventDefault()
      if (open && highlighted >= 0) take(items[highlighted] as Completion)
      else submit()
      return
    }
    // With the popup closed, up and down walk the history, but only from the
    // first line: a draft of several lines has to stay editable.
    if (pressed.key === 'ArrowUp' && isWalkable(text, caret) && walk(1)) pressed.preventDefault()
    else if (pressed.key === 'ArrowDown' && back > 0 && walk(-1)) pressed.preventDefault()
  }

  return (
    <div className="relative">
      <CompletionList
        items={items}
        highlighted={highlighted}
        listId={listId}
        onTake={take}
        onHighlight={setHighlighted}
      />
      <textarea
        ref={input}
        rows={3}
        value={text}
        placeholder="Message Claude Code"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(highlighted >= 0 && { 'aria-activedescendant': `${listId}-${highlighted}` })}
        onChange={(changed) => rewrite(changed.target.value, changed.target.selectionStart)}
        onSelect={(moved) => setCaret(moved.currentTarget.selectionStart)}
        onKeyDown={handleKey}
        className="w-full resize-none rounded-sm border border-input bg-background px-3 py-2 text-[15px] leading-relaxed placeholder:text-muted-foreground focus-visible:border-keel focus-visible:outline-none"
      />
    </div>
  )
}
