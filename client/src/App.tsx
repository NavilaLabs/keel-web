import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
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
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-border p-3">
        <h1 className="mb-2 text-sm text-foreground">keel</h1>

        <form
          className="mb-2 flex gap-1"
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
            placeholder="Ticket"
            onChange={(changed) => setEntry(changed.target.value)}
            className="w-full min-w-0 border border-input bg-background px-2 py-1 text-sm"
          />
          <Button type="submit" size="sm" variant="outline">
            Open
          </Button>
        </form>

        {opened.map((ticketId) => (
          <button
            key={ticketId}
            type="button"
            onClick={() => open(ticketId)}
            className={`px-2 py-1 text-left text-sm ${
              ticketId === route.ticketId
                ? 'border-l-2 border-brand bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            Ticket {ticketId}
          </button>
        ))}
      </nav>

      <main className="min-w-0 flex-1 p-6">
        <p className="text-sm text-muted-foreground">
          Tickets, pull requests and diagrams appear here in a later ticket.
        </p>
      </main>

      <ChatColumn store={store} ticketId={route.ticketId} />
    </div>
  )
}
