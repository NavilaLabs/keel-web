import { Hono } from 'hono'
import type { ArtifactContent, ArtifactTree } from '@keel-web/protocol'
import { describe, expect, it } from 'vitest'
import type { Workspace, WorkspaceRegistry } from '../workspaces/types.js'
import { createArtifactRoutes } from './create-artifact-routes.js'
import {
  ArtifactOutsideWorkspaceError,
  UnreadableArtifactError,
  type ArtifactReader,
} from './types.js'

const workspace: Workspace = {
  id: 'w1',
  name: 'keel-web',
  path: '/repositories/keel-web',
  reachable: true,
  ticketRepository: '/repositories/keel-web-tickets',
}

const workspaces = {
  find: (id: string) => (id === 'w1' ? workspace : undefined),
} as unknown as WorkspaceRegistry

const tree: ArtifactTree = { ticketId: '9', nodes: [] }

const content: ArtifactContent = {
  ref: { kind: 'knowledge', repository: 'ticket', path: 'tickets/9/knowledge.md' },
  text: '# 9\n',
  etag: '"abc"',
}

function app(artifacts: Partial<ArtifactReader>) {
  const routes = new Hono()
  routes.route('/api', createArtifactRoutes({ artifacts: artifacts as ArtifactReader, workspaces }))
  return routes
}

const contentPath =
  '/api/workspaces/w1/tickets/9/artifacts/content?kind=knowledge&path=tickets/9/knowledge.md'

describe('the artefact routes', () => {
  it('answers with the tree of a known workspace', async () => {
    const routes = app({ tree: async () => tree })

    const response = await routes.request('/api/workspaces/w1/tickets/9/artifacts')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(tree)
  })

  it('refuses a workspace it does not know', async () => {
    const routes = app({ tree: async () => tree })

    const response = await routes.request('/api/workspaces/w9/tickets/9/artifacts')

    expect(response.status).toBe(404)
  })

  it('answers with the artefact and its entity tag', async () => {
    const routes = app({ read: async () => content })

    const response = await routes.request(contentPath)

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"abc"')
    expect(await response.json()).toEqual(content)
  })

  it('answers 304 to a viewer that already holds it', async () => {
    const routes = app({ read: async () => content })

    const response = await routes.request(contentPath, { headers: { 'if-none-match': '"abc"' } })

    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
  })

  it('sends the artefact again once its tag has changed', async () => {
    const routes = app({ read: async () => content })

    const response = await routes.request(contentPath, { headers: { 'if-none-match': '"old"' } })

    expect(response.status).toBe(200)
  })

  it('refuses a request that names no artefact', async () => {
    const routes = app({ read: async () => content })

    const response = await routes.request(
      '/api/workspaces/w1/tickets/9/artifacts/content?kind=file',
    )

    expect(response.status).toBe(400)
  })

  it('refuses a view, which is not read here', async () => {
    const routes = app({ read: async () => content })

    const response = await routes.request(
      '/api/workspaces/w1/tickets/9/artifacts/content?kind=c4View&path=server',
    )

    expect(response.status).toBe(400)
  })

  it('reports a path that escapes the repository as a bad request', async () => {
    const routes = app({
      read: async () => {
        throw new ArtifactOutsideWorkspaceError('../../etc/passwd lies outside the repository.')
      },
    })

    const response = await routes.request(contentPath)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      reason: '../../etc/passwd lies outside the repository.',
    })
  })

  it('reports a missing artefact as not found, with the reason', async () => {
    const routes = app({
      read: async () => {
        throw new UnreadableArtifactError('There is nothing at tickets/9/gone.md.')
      },
    })

    const response = await routes.request(contentPath)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ reason: 'There is nothing at tickets/9/gone.md.' })
  })
})
