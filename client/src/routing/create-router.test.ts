import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from './create-router.ts'

function at(path: string) {
  globalThis.history.replaceState(null, '', path)
  return createRouter()
}

describe('router', () => {
  beforeEach(() => {
    globalThis.history.replaceState(null, '', '/')
  })

  it('reads nothing from the root path', () => {
    expect(at('/').current()).toEqual({ view: 'none' })
  })

  it('reads a workspace on its own', () => {
    expect(at('/workspaces/w1').current()).toEqual({ workspaceId: 'w1', view: 'none' })
  })

  it('reads a workspace and a ticket', () => {
    expect(at('/workspaces/w1/tickets/4').current()).toEqual({
      workspaceId: 'w1',
      ticketId: '4',
      view: 'none',
    })
  })

  it('treats a path it cannot parse as no selection rather than throwing', () => {
    expect(at('/something/else').current()).toEqual({ view: 'none' })
    expect(at('/tickets/4').current()).toEqual({ view: 'none' })
  })

  it('decodes what it reads', () => {
    expect(at('/workspaces/w%201/tickets/PROJ-4').current()).toMatchObject({ ticketId: 'PROJ-4' })
  })

  it('pushes a history entry, so the back button works', () => {
    const router = at('/')

    router.navigate({ workspaceId: 'w1', ticketId: '4', view: 'none' })

    expect(globalThis.location.pathname).toBe('/workspaces/w1/tickets/4')
    expect(router.current()).toMatchObject({ workspaceId: 'w1', ticketId: '4' })
  })

  it('writes a workspace without a ticket', () => {
    const router = at('/')

    router.navigate({ workspaceId: 'w1', view: 'none' })

    expect(globalThis.location.pathname).toBe('/workspaces/w1')
  })

  it('does not push the path it is already on', () => {
    const router = at('/workspaces/w1')
    const push = vi.spyOn(globalThis.history, 'pushState')

    router.navigate({ workspaceId: 'w1', view: 'none' })

    expect(push).not.toHaveBeenCalled()
    push.mockRestore()
  })

  it('reports back and forward, and stops after unsubscribing', () => {
    const router = at('/')
    const listener = vi.fn()
    const unsubscribe = router.subscribe(listener)

    globalThis.dispatchEvent(new PopStateEvent('popstate'))
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('the artefact in the URL', () => {
  beforeEach(() => {
    globalThis.history.replaceState(null, '', '/')
  })

  it('reads a document beside the ticket', () => {
    expect(
      at('/workspaces/w1/tickets/9?kind=knowledge&path=tickets/9/knowledge.md').current(),
    ).toEqual({
      workspaceId: 'w1',
      ticketId: '9',
      view: 'artifact',
      artifact: { kind: 'knowledge', repository: 'ticket', path: 'tickets/9/knowledge.md' },
    })
  })

  it('reads a stub with its symbol, out of the code repository', () => {
    expect(
      at('/workspaces/w1/tickets/9?kind=stub&path=server/src/x.ts&symbol=Reader').current()
        .artifact,
    ).toEqual({ kind: 'stub', repository: 'code', path: 'server/src/x.ts', symbol: 'Reader' })
  })

  it('reads a view with the branch its model lives on', () => {
    expect(
      at('/workspaces/w1/tickets/9?kind=c4View&view=server&branch=ticket/9').current().artifact,
    ).toEqual({ kind: 'c4View', view: 'server', branch: 'ticket/9' })
  })

  it('lands on the ticket rather than an error when the link is mangled', () => {
    expect(at('/workspaces/w1/tickets/9?kind=knowledge').current()).toEqual({
      workspaceId: 'w1',
      ticketId: '9',
      view: 'none',
    })
    expect(at('/workspaces/w1/tickets/9?kind=nonsense&path=x').current().view).toBe('none')
  })

  it('ignores an artefact without a ticket, which cannot be resolved', () => {
    expect(at('/workspaces/w1?kind=knowledge&path=tickets/9/knowledge.md').current()).toEqual({
      workspaceId: 'w1',
      view: 'none',
    })
  })

  it('writes the artefact back into the URL', () => {
    const router = at('/')
    router.navigate({
      workspaceId: 'w1',
      ticketId: '9',
      view: 'artifact',
      artifact: { kind: 'adr', repository: 'ticket', path: 'tickets/9/adr/0015.md' },
    })

    expect(globalThis.location.pathname + globalThis.location.search).toBe(
      '/workspaces/w1/tickets/9?kind=adr&path=tickets%2F9%2Fadr%2F0015.md',
    )
  })

  it('drops the artefact from the URL when the centre shows none', () => {
    const router = at('/workspaces/w1/tickets/9?kind=adr&path=tickets/9/adr/0015.md')
    router.navigate({ workspaceId: 'w1', ticketId: '9', view: 'none' })

    expect(globalThis.location.search).toBe('')
  })
})
