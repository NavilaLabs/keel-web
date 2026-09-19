import { useEffect, useMemo, useState } from 'react'
import { ChatColumn } from './chat/chat-column.tsx'
import { createConnection } from './connection/create-connection.ts'
import { useRoute } from './routing/use-route.ts'
import { createTranscriptStore } from './transcript/create-transcript-store.ts'

export default function App() {
  const { route, navigate } = useRoute()
  const store = useMemo(() => createTranscriptStore({ connection: createConnection('/api') }), [])
  const [opened, setOpened] = useState<string[]>(() =>
    route.ticketId === undefined ? [] : [route.ticketId],
  )
  const [entry, setEntry] = useState('')

  // The store owns the stream, so this only tells it which ticket to be on.
  useEffect(() => {
    if (route.ticketId === undefined) return
    store.connect(route.ticketId)
  }, [route.ticketId, store])

  const open = (ticketId: string) => {
    setOpened((previous) => (previous.includes(ticketId) ? previous : [...previous, ticketId]))
    navigate({ ticketId, view: 'none' })
  }

  return (
    <div className="flex h-full">
      <nav className="flex w-60 shrink-0 flex-col border-r border-border px-3 py-4">
        <span className="px-2 pb-5 font-mono text-[13px] tracking-tight text-keel">keel</span>

        <form
          className="pb-4"
          onSubmit={(submitted) => {
            submitted.preventDefault()
            const ticketId = entry.trim()
            if (ticketId === '') return
            setEntry('')
            open(ticketId)
          }}
        >
          <input
            value={entry}
            placeholder="Ticket number"
            onChange={(changed) => setEntry(changed.target.value)}
            className="w-full rounded-sm border border-input bg-background px-2 py-1.5 font-mono text-[13px] placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-keel focus-visible:outline-none"
          />
        </form>

        {opened.map((ticketId) => {
          const active = ticketId === route.ticketId
          return (
            <button
              key={ticketId}
              type="button"
              onClick={() => open(ticketId)}
              className={`-ml-px border-l-2 py-1.5 pl-3 text-left font-mono text-[13px] focus-visible:outline-none ${
                active
                  ? 'border-keel text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              {ticketId}
            </button>
          )
        })}
      </nav>

      <main className="flex min-w-0 flex-1 items-end p-10">
        {route.ticketId === undefined ? (
          <p className="max-w-[40ch] text-[15px] leading-relaxed text-muted-foreground">
            Open a ticket to start a session. Everything the agent does stays visible here, and
            nothing runs until you allow it.
          </p>
        ) : (
          <p className="max-w-[40ch] text-[13px] text-muted-foreground">
            The ticket, its pull request and the architecture diagrams land in this space.
          </p>
        )}
      </main>

      <ChatColumn store={store} ticketId={route.ticketId} />
    </div>
  )
}
