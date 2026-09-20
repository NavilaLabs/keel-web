import type { PermissionDecision, TicketId, WorkspaceId } from '@keel-web/protocol'
import { useEffect, useRef } from 'react'
import { Composer } from '../composer/composer.tsx'
import type { DraftBook } from '../composer/types.ts'
import { nextMode } from '../session-controls/modes.ts'
import { StatusLine } from '../session-controls/status-line.tsx'
import type { SessionControlsStore } from '../session-controls/types.ts'
import { useSessionControls } from '../session-controls/use-session-controls.ts'
import type { TranscriptStore } from '../transcript/types.ts'
import { useDraft, useTranscript } from '../transcript/use-transcript.ts'
import { Transcript } from './transcript.tsx'

interface ChatColumnProperties {
  store: TranscriptStore
  controls: SessionControlsStore
  drafts: DraftBook
  workspaceId: WorkspaceId | undefined
  ticketId: TicketId | undefined
}

export function ChatColumn({
  store,
  controls,
  drafts,
  workspaceId,
  ticketId,
}: ChatColumnProperties) {
  const items = useTranscript(store)
  const draft = useDraft(store)
  const sessionControls = useSessionControls(controls)
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

  const cycleMode = () => {
    const current = controls.getControls()
    if (current === undefined) return
    void controls.change({ mode: nextMode(current.settings.mode) })
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

      <div className="border-t border-border px-5 py-4">
        <Composer
          key={`${workspaceId ?? ''}/${ticketId}`}
          session={workspaceId === undefined ? undefined : { workspaceId, ticketId }}
          commands={sessionControls?.commands ?? []}
          drafts={drafts}
          onSend={(message) => void store.send(message)}
          onCycleMode={cycleMode}
        />
        <StatusLine store={controls} />
      </div>
    </aside>
  )
}
