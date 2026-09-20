import type { ArtifactRef, ArtifactTree } from '@keel-web/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCentreStore } from './create-centre-store.ts'

const knowledge: ArtifactRef = {
  kind: 'knowledge',
  repository: 'ticket',
  path: 'tickets/9/knowledge.md',
}

const decision: ArtifactRef = {
  kind: 'adr',
  repository: 'ticket',
  path: 'tickets/9/adr/0015.md',
}

const tree: ArtifactTree = { ticketId: '9', nodes: [] }

function answer(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

let calls: { url: string; headers: Headers }[]

function respondWith(handler: (url: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, headers: new Headers(init?.headers) })
      return Promise.resolve(handler(url))
    }),
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  calls = []
  respondWith((url) =>
    url.includes('/content')
      ? answer({ ref: knowledge, text: '# 9\n', etag: '"one"' })
      : answer(tree),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the centre store', () => {
  it('reads the tree of the ticket it is pointed at', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })

    store.select('9')
    await settle()

    expect(store.snapshot().tree).toEqual(tree)
    expect(calls[0]?.url).toBe('/api/workspaces/w1/tickets/9/artifacts')
    store.dispose()
  })

  it('opens an artefact, makes it active and reads it', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })
    store.select('9')

    store.open(knowledge)
    await settle()

    expect(store.snapshot().active).toBe(0)
    expect(store.snapshot().open[0]?.content?.text).toBe('# 9\n')
    store.dispose()
  })

  it('activates an artefact that is already open instead of opening it twice', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })
    store.select('9')
    store.open(knowledge)
    store.open(decision)
    await settle()

    store.open(knowledge)

    expect(store.snapshot().open).toHaveLength(2)
    expect(store.snapshot().active).toBe(0)
    store.dispose()
  })

  it('leaves the tab that was in front standing, so one click is back', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })
    store.select('9')
    store.open(knowledge)

    store.open(decision)

    expect(store.snapshot().open.map((artifact) => artifact.label)).toEqual([
      'knowledge.md',
      '0015.md',
    ])
    expect(store.snapshot().active).toBe(1)
    store.dispose()
  })

  it('keeps what is on screen when the answer is 304', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })
    store.select('9')
    store.open(knowledge)
    await settle()
    const before = store.snapshot().open[0]?.content

    respondWith(() => new Response(null, { status: 304 }))
    store.refresh()
    await settle()

    expect(store.snapshot().open[0]?.content).toBe(before)
    store.dispose()
  })

  it('sends the tag it holds when asking again', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })
    store.select('9')
    store.open(knowledge)
    await settle()
    calls = []

    store.refresh()
    await settle()

    expect(calls[0]?.headers.get('if-none-match')).toBe('"one"')
    store.dispose()
  })

  it('takes the new content when the artefact has changed', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })
    store.select('9')
    store.open(knowledge)
    await settle()

    respondWith(() => answer({ ref: knowledge, text: '# 9, rewritten\n', etag: '"two"' }))
    store.refresh()
    await settle()

    expect(store.snapshot().open[0]?.content?.text).toBe('# 9, rewritten\n')
    store.dispose()
  })

  it('explains an artefact it cannot read, in place of its content', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })
    store.select('9')

    respondWith(() => answer({ reason: 'There is nothing at tickets/9/gone.md.' }, { status: 404 }))
    store.open({ kind: 'document', repository: 'ticket', path: 'tickets/9/gone.md' })
    await settle()

    expect(store.snapshot().open[0]?.error).toBe('There is nothing at tickets/9/gone.md.')
    expect(store.snapshot().open[0]?.content).toBeUndefined()
    store.dispose()
  })

  it('closing the active tab falls back to its left neighbour', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })
    store.select('9')
    store.open(knowledge)
    store.open(decision)

    store.close(1)

    expect(store.snapshot().active).toBe(0)
    expect(store.snapshot().open).toHaveLength(1)
    store.dispose()
  })

  it('closing the last tab leaves nothing active', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })
    store.select('9')
    store.open(knowledge)

    store.close(0)

    expect(store.snapshot().active).toBeUndefined()
    store.dispose()
  })

  it('remembers per ticket what was open', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })
    store.select('9')
    store.open(knowledge)
    await settle()

    store.select('7')
    expect(store.snapshot().open).toEqual([])

    store.select('9')
    expect(store.snapshot().open.map((artifact) => artifact.label)).toEqual(['knowledge.md'])
    store.dispose()
  })

  it('tells the listener whenever what it shows changes', async () => {
    const store = createCentreStore({ workspaceId: 'w1', interval: 0 })
    const listener = vi.fn()
    store.subscribe(listener)

    store.select('9')

    expect(listener).toHaveBeenCalled()
    store.dispose()
  })
})
