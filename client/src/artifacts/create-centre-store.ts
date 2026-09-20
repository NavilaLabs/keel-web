import type { ArtifactContent, ArtifactRef, ArtifactTree, TicketId } from '@keel-web/protocol'
import type {
  CentreSnapshot,
  CentreStore,
  CreateCentreStore,
  OpenArtifact,
  Unsubscribe,
} from './types.ts'

const defaultInterval = 3000

/** Two references name the same artefact when every field agrees. */
export function sameArtifact(one: ArtifactRef, other: ArtifactRef): boolean {
  if (one.kind !== other.kind) return false
  if (one.kind === 'c4View' && other.kind === 'c4View') {
    return one.view === other.view && one.branch === other.branch
  }
  if (one.kind === 'c4View' || other.kind === 'c4View') return false
  return one.repository === other.repository && one.path === other.path
}

/** What the tab strip calls an artefact before its content has arrived. */
function labelOf(ref: ArtifactRef): string {
  if (ref.kind === 'c4View') return ref.view
  if (ref.kind === 'stub' && ref.symbol) return ref.symbol
  return ref.path.split('/').at(-1) ?? ref.path
}

function queryOf(ref: ArtifactRef): string {
  const query = new URLSearchParams({ kind: ref.kind })
  if (ref.kind === 'c4View') {
    query.set('view', ref.view)
    if (ref.branch) query.set('branch', ref.branch)
  } else {
    query.set('path', ref.path)
    if (ref.kind === 'stub' && ref.symbol) query.set('symbol', ref.symbol)
  }
  return query.toString()
}

function reasonOf(body: unknown, fallback: string): string {
  const reason = (body as { reason?: unknown } | undefined)?.reason
  return typeof reason === 'string' ? reason : fallback
}

export const createCentreStore: CreateCentreStore = ({
  workspaceId,
  interval = defaultInterval,
}): CentreStore => {
  const listeners = new Set<() => void>()

  // What was open per ticket, so moving between tickets and back restores the
  // tabs rather than the empty centre.
  const remembered = new Map<TicketId, { open: OpenArtifact[]; active?: number }>()

  let ticketId: TicketId | undefined
  let tree: ArtifactTree | undefined
  let treeError: string | undefined
  let open: OpenArtifact[] = []
  let active: number | undefined
  let snapshot: CentreSnapshot = { open, active }
  let timer: ReturnType<typeof setInterval> | undefined
  let reading: AbortController | undefined

  function publish(): void {
    snapshot = {
      ...(ticketId !== undefined && { ticketId }),
      ...(tree !== undefined && { tree }),
      ...(treeError !== undefined && { treeError }),
      open: [...open],
      ...(active !== undefined && { active }),
    }
    if (ticketId !== undefined) remembered.set(ticketId, { open: [...open], active })
    for (const listener of listeners) listener()
  }

  function replace(index: number, artifact: OpenArtifact): void {
    if (open[index] === undefined) return
    open = open.map((entry, position) => (position === index ? artifact : entry))
    publish()
  }

  async function loadTree(forTicket: TicketId): Promise<void> {
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/tickets/${encodeURIComponent(forTicket)}/artifacts`,
      )
      const body: unknown = await response.json()
      if (ticketId !== forTicket) return
      if (!response.ok) {
        treeError = reasonOf(body, 'The artefacts of this ticket could not be read.')
        tree = undefined
      } else {
        tree = body as ArtifactTree
        treeError = undefined
      }
    } catch {
      if (ticketId !== forTicket) return
      treeError = 'keel-web could not be reached.'
      tree = undefined
    }
    publish()
  }

  /**
   * Reads one artefact, sending the tag it already holds.
   *
   * A 304 means what is on screen is current, and nothing is replaced. That
   * is what keeps the reader's place: the content object stays identical, so
   * nothing below it re-renders.
   */
  async function load(index: number, conditional: boolean): Promise<void> {
    const artifact = open[index]
    if (artifact === undefined || ticketId === undefined) return
    if (artifact.ref.kind === 'c4View') return

    const held = conditional ? artifact.content?.etag : undefined
    reading?.abort()
    const controller = new AbortController()
    reading = controller

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/tickets/${encodeURIComponent(ticketId)}/artifacts/content?${queryOf(artifact.ref)}`,
        {
          signal: controller.signal,
          ...(held && { headers: { 'If-None-Match': held } }),
        },
      )
      if (response.status === 304) return

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => undefined)
        replace(index, {
          ref: artifact.ref,
          label: artifact.label,
          error: reasonOf(body, 'This artefact could not be read.'),
        })
        return
      }

      const content = (await response.json()) as ArtifactContent
      replace(index, { ref: artifact.ref, label: artifact.label, content })
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      replace(index, {
        ref: artifact.ref,
        label: artifact.label,
        error: 'keel-web could not be reached.',
      })
    }
  }

  function startPolling(): void {
    if (timer !== undefined || interval <= 0) return
    timer = setInterval(() => {
      // A tab nobody is looking at does not need to be current, and a hidden
      // page should not keep asking.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (active !== undefined) void load(active, true)
    }, interval)
  }

  return {
    snapshot: () => snapshot,

    subscribe(listener): Unsubscribe {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    select(next) {
      if (next === ticketId) return
      reading?.abort()
      reading = undefined
      ticketId = next
      tree = undefined
      treeError = undefined

      const held = next === undefined ? undefined : remembered.get(next)
      open = held ? [...held.open] : []
      active = held?.active
      publish()

      if (next === undefined) return
      void loadTree(next)
      if (active !== undefined) void load(active, false)
      startPolling()
    },

    open(ref) {
      const existing = open.findIndex((artifact) => sameArtifact(artifact.ref, ref))
      if (existing !== -1) {
        active = existing
        publish()
        return
      }

      open = [...open, { ref, label: labelOf(ref) }]
      active = open.length - 1
      publish()
      void load(active, false)
      startPolling()
    },

    activate(index) {
      if (open[index] === undefined) return
      active = index
      publish()
      void load(index, true)
    },

    close(index) {
      if (open[index] === undefined) return
      const wasActive = active === index
      open = open.filter((_, position) => position !== index)

      if (open.length === 0) active = undefined
      else if (wasActive) active = Math.max(0, index - 1)
      else if (active !== undefined && active > index) active -= 1

      publish()
    },

    refresh() {
      if (active !== undefined) void load(active, true)
    },

    dispose() {
      reading?.abort()
      reading = undefined
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      listeners.clear()
    },
  }
}
