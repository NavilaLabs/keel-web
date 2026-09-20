import { useEffect, useMemo, useState } from 'react'
import type { ArtifactRef } from '@keel-web/protocol'
import { Centre } from './artifacts/centre.tsx'
import { useCentre } from './artifacts/use-centre.ts'
import { ChatColumn } from './chat/chat-column.tsx'
import { createConnection } from './connection/create-connection.ts'
import { DirectoryPicker } from './directories/directory-picker.tsx'
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
  const [picking, setPicking] = useState(false)
  const [collapsed, setCollapsed] = useState(route.ticketId !== undefined)

  const workspace = workspaces.find((candidate) => candidate.id === route.workspaceId)
  const { centre, snapshot } = useCentre(route.workspaceId, route.ticketId)

  // The URL says which artefact is open, so a deep link and a reload land on
  // the same one. Opening it again is a no-op once it is already open.
  useEffect(() => {
    if (route.view === 'artifact' && route.artifact) centre?.open(route.artifact)
  }, [route.view, route.artifact, centre])

  // The store owns the stream, so this only tells it which session to be on.
  useEffect(() => {
    const { workspaceId, ticketId } = route
    if (workspaceId === undefined || ticketId === undefined) return
    store.connect({ workspaceId, ticketId })
  }, [route, store])

  const openTicket = (ticketId: string) => {
    if (route.workspaceId === undefined) return
    setOpened((previous) => (previous.includes(ticketId) ? previous : [...previous, ticketId]))
    setCollapsed(true)
    navigate({ workspaceId: route.workspaceId, ticketId, view: 'none' })
  }

  const openWorkspace = (workspaceId: string) => {
    setOpened([])
    setCollapsed(false)
    navigate({ workspaceId, view: 'none' })
  }

  const openArtifact = (artifact: ArtifactRef) => {
    if (route.workspaceId === undefined || route.ticketId === undefined) return
    centre?.open(artifact)
    navigate({
      workspaceId: route.workspaceId,
      ticketId: route.ticketId,
      view: 'artifact',
      artifact,
    })
  }

  return (
    <div className="flex h-full">
      {collapsed && (
        <button
          type="button"
          aria-label="Show the repositories"
          onClick={() => setCollapsed(false)}
          className="shrink-0 border-r border-border px-2 py-4 text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none"
        >
          <span aria-hidden className="font-mono">
            ›
          </span>
        </button>
      )}

      <nav
        className={`${collapsed ? 'hidden' : 'flex'} w-60 shrink-0 flex-col border-r border-border px-3 py-4`}
      >
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

          <button
            type="button"
            onClick={() => setPicking(true)}
            className="mt-3 rounded-sm border border-dashed border-border py-1.5 text-[13px] text-muted-foreground hover:border-keel hover:text-foreground focus-visible:border-keel focus-visible:outline-none"
          >
            Add a repository
          </button>
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

      <main className="flex min-h-0 min-w-0 flex-1">
        {route.ticketId === undefined || centre === undefined ? (
          <p className="max-w-[40ch] self-end p-10 text-[15px] leading-relaxed text-muted-foreground">
            {workspace === undefined
              ? 'Pick a repository to work in. Everything the agent does stays visible, and nothing runs until you allow it.'
              : workspace.state === 'ready'
                ? `Open a ticket in ${workspace.name} to start a session.`
                : workspace.reason}
          </p>
        ) : (
          <Centre
            workspaceId={route.workspaceId ?? ''}
            centre={centre}
            snapshot={snapshot}
            onOpen={openArtifact}
          />
        )}
      </main>

      <DirectoryPicker
        open={picking}
        onOpenChange={setPicking}
        onChoose={(chosen) => void add(chosen)}
      />

      <ChatColumn store={store} ticketId={route.ticketId} />
    </div>
  )
}
