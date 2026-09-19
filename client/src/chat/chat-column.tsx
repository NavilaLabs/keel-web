import type { PermissionDecision, TicketId } from '@keel-web/protocol'
import { useEffect, useRef, useState } from 'react'
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
    return <aside className="w-[42rem] shrink border-l border-border" />
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

  const running = items.some((item) => item.kind === 'tool' && item.result === undefined)

  return (
    <aside className="flex w-[42rem] shrink flex-col border-l border-border">
      <header className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <h2 className="font-mono text-[13px] text-foreground">ticket {ticketId}</h2>
        {running && (
          <button
            type="button"
            onClick={() => void store.interrupt()}
            className="rounded-sm px-2 py-1 text-[13px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-1 focus-visible:ring-keel focus-visible:outline-none"
          >
            Stop
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        {items.length === 0 && draft === '' ? (
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-muted-foreground">
            This session runs the keel workflow in the code repository. Ask it where the ticket
            stands, or send it a slash command.
          </p>
        ) : (
          <Transcript items={items} draft={draft} onAnswer={answer} />
        )}
        <div ref={bottom} />
      </div>

      <form
        className="border-t border-border px-5 py-4"
        onSubmit={(submitted) => {
          submitted.preventDefault()
          submit()
        }}
      >
        <textarea
          rows={3}
          value={text}
          placeholder="Message Claude Code"
          onChange={(changed) => setText(changed.target.value)}
          onKeyDown={(pressed) => {
            if (pressed.key === 'Enter' && !pressed.shiftKey) {
              pressed.preventDefault()
              submit()
            }
          }}
          className="w-full resize-none rounded-sm border border-input bg-background px-3 py-2 text-[15px] leading-relaxed placeholder:text-muted-foreground focus-visible:border-keel focus-visible:outline-none"
        />
        <p className="pt-1.5 text-[12px] text-muted-foreground">
          Enter sends, shift and enter starts a line.
        </p>
      </form>
    </aside>
  )
}
