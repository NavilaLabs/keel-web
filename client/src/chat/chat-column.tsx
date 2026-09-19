import type { PermissionDecision, TicketId } from '@keel-web/protocol'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import type { TranscriptStore } from '../transcript/types.ts'
import { useDraft, useTranscript } from '../transcript/use-transcript.ts'
import { Transcript } from './transcript.tsx'

interface ChatColumnProperties {
  store: TranscriptStore
  ticketId: TicketId | undefined
}

export function ChatColumn({ store, ticketId }: ChatColumnProperties) {
  const items = useTranscript(store)
  const draft = useDraft(store)
  const [text, setText] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [items, draft])

  if (ticketId === undefined) {
    return (
      <aside className="flex w-[34rem] shrink-0 items-center justify-center border-l border-border p-6">
        <p className="text-sm text-muted-foreground">Open a ticket to start a session.</p>
      </aside>
    )
  }

  const answer = (requestId: string, decision: PermissionDecision) => {
    void store.answer(requestId, decision)
  }

  const submit = () => {
    const message = text.trim()
    if (message === '') return
    setText('')
    void store.send(message)
  }

  return (
    <aside className="flex w-[34rem] shrink-0 flex-col border-l border-border">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm text-foreground">Ticket {ticketId}</h2>
        <Button size="sm" variant="ghost" onClick={() => void store.interrupt()}>
          Interrupt
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <Transcript items={items} draft={draft} onAnswer={answer} />
        <div ref={bottom} />
      </div>

      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(submitted) => {
          submitted.preventDefault()
          submit()
        }}
      >
        <textarea
          rows={2}
          value={text}
          placeholder="Message Claude Code"
          onChange={(changed) => setText(changed.target.value)}
          onKeyDown={(pressed) => {
            if (pressed.key === 'Enter' && !pressed.shiftKey) {
              pressed.preventDefault()
              submit()
            }
          }}
          className="min-h-0 flex-1 resize-none border border-input bg-background p-2 text-sm"
        />
        <Button type="submit" size="sm">
          Send
        </Button>
      </form>
    </aside>
  )
}
