import { useEffect, useMemo, useState } from 'react'
import { ChatColumn } from './chat/chat-column.tsx'
import { createConnection } from './connection/create-connection.ts'
import { useRoute } from './routing/use-route.ts'
import { createTranscriptStore } from './transcript/create-transcript-store.ts'
import { useWorkspaces } from './workspaces/use-workspaces.ts'

export default function App() {
  const { route, navigate } = useRoute()
  const { workspaces, loading, error, add, remove } = useWorkspaces()
  const store = useMemo(() => createTranscriptStore({ connection: createConnection('/api') }), [])
  const [opened, setOpened] = useState<string[]>(() =>
    route.ticketId === undefined ? [] : [route.ticketId],
  )
  const [entry, setEntry] = useState('')
  const [path, setPath] = useState('')

  const workspace = workspaces.find((candidate) => candidate.id === route.workspaceId)

  // The store owns the stream, so this only tells it which session to be on.
  useEffect(() => {
    const { workspaceId, ticketId } = route
    if (workspaceId === undefined || ticketId === undefined) return
    store.connect({ workspaceId, ticketId })
  }, [route, store])

  const openTicket = (ticketId: string) => {
    if (route.workspaceId === undefined) return
    setOpened((previous) => (previous.includes(ticketId) ? previous : [...previous, ticketId]))
    navigate({ workspaceId: route.workspaceId, ticketId, view: 'none' })
  }

  const openWorkspace = (workspaceId: string) => {
    setOpened([])
    navigate({ workspaceId, view: 'none' })
  }

  return (
    <div className="flex h-full">
      <nav className="flex w-60 shrink-0 flex-col border-r border-border px-3 py-4">
        <span className="px-2 pb-5 font-mono text-[13px] tracking-tight text-keel">keel</span>

        <div className="flex flex-col pb-5">
          {loading && <span className="px-2 text-[13px] text-muted-foreground">Loading</span>}
          {!loading && workspaces.length === 0 && (
            <p className="px-2 text-[13px] leading-relaxed text-muted-foreground">
              No repositories yet. Add one by its path below.
            </p>
          )}
          {workspaces.map((candidate) => {
            const active = candidate.id === route.workspaceId
            const ready = candidate.state === 'ready'
            return (
              <div key={candidate.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => openWorkspace(candidate.id)}
                  className={`-ml-px min-w-0 flex-1 border-l-2 py-1.5 pl-3 text-left text-[13px] focus-visible:outline-none ${
                    active
                      ? 'border-keel text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                  title={ready ? candidate.path : candidate.reason}
                >
                  <span className="block truncate">{candidate.name}</span>
                </button>
                {!ready && (
                  <span
                    aria-hidden
                    title={candidate.reason}
                    className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
                  />
                )}
                <button
                  type="button"
                  aria-label={`Remove ${candidate.name}`}
                  onClick={() => void remove(candidate.id)}
                  className="shrink-0 px-2 text-[13px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none"
                >
                  &times;
                </button>
              </div>
            )
          })}

          <form
            className="pt-3"
            onSubmit={(submitted) => {
              submitted.preventDefault()
              const entered = path.trim()
              if (entered === '') return
              setPath('')
              void add(entered)
            }}
          >
            <input
              value={path}
              placeholder="Add a repository path"
              onChange={(changed) => setPath(changed.target.value)}
              className="w-full rounded-sm border border-input bg-background px-2 py-1.5 font-mono text-[13px] placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-keel focus-visible:outline-none"
            />
          </form>
          {error !== undefined && (
            <p className="px-2 pt-2 text-[13px] leading-relaxed text-destructive">{error}</p>
          )}
        </div>

        {workspace?.state === 'ready' && (
          <>
            <form
              className="pb-3"
              onSubmit={(submitted) => {
                submitted.preventDefault()
                const ticketId = entry.trim()
                if (ticketId === '') return
                setEntry('')
                openTicket(ticketId)
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
                  onClick={() => openTicket(ticketId)}
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
          </>
        )}
      </nav>

      <main className="flex min-w-0 flex-1 items-end p-10">
        {route.ticketId === undefined ? (
          <p className="max-w-[40ch] text-[15px] leading-relaxed text-muted-foreground">
            {workspace === undefined
              ? 'Pick a repository to work in. Everything the agent does stays visible, and nothing runs until you allow it.'
              : workspace.state === 'ready'
                ? `Open a ticket in ${workspace.name} to start a session.`
                : workspace.reason}
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
