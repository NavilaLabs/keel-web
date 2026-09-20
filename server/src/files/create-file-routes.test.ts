import type { FileMatches } from '@keel-web/protocol'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { LoggerVariables } from '../logging/types.js'
import type { Workspace, WorkspaceRegistry } from '../workspaces/types.js'
import { createFileRoutes } from './create-file-routes.js'
import type { FileIndex } from './types.js'

const known: Workspace[] = [{ id: 'w1', name: 'one', path: '/code', ticketRepository: '/tickets' }]

const workspaces: WorkspaceRegistry = {
  list: () => known,
  find: (id) => known.find((workspace) => workspace.id === id),
}

const nothing: FileMatches = { entries: [], truncated: false }

function appWith(files: FileIndex) {
  const app = new Hono<{ Variables: LoggerVariables }>()
  app.route('/', createFileRoutes({ files, workspaces }))
  return app
}

function indexStub(answer: FileMatches = nothing): FileIndex {
  return { matches: vi.fn(async () => answer) }
}

describe('file route', () => {
  it('answers the entries a query matches', async () => {
    const files = indexStub({
      entries: [{ path: 'client/src/chat.tsx', kind: 'file' }],
      truncated: false,
    })

    const response = await appWith(files).request('/workspaces/w1/files?query=chat&limit=5')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      entries: [{ path: 'client/src/chat.tsx', kind: 'file' }],
      truncated: false,
    })
    expect(files.matches).toHaveBeenCalledWith('w1', 'chat', 5)
  })

  it('reads a missing query as an empty one, which is an @ with nothing typed yet', async () => {
    const files = indexStub()

    await appWith(files).request('/workspaces/w1/files')

    expect(files.matches).toHaveBeenCalledWith('w1', '', 20)
  })

  it('refuses a workspace it does not know', async () => {
    expect((await appWith(indexStub()).request('/workspaces/gone/files')).status).toBe(404)
  })

  it('refuses a limit that is not a positive whole number', async () => {
    const app = appWith(indexStub())

    for (const limit of ['0', '-1', 'many', '1.5']) {
      expect((await app.request(`/workspaces/w1/files?limit=${limit}`)).status).toBe(400)
    }
  })

  it('caps a limit that would answer with more than a popup can show', async () => {
    const files = indexStub()

    await appWith(files).request('/workspaces/w1/files?limit=100000')

    expect(files.matches).toHaveBeenCalledWith('w1', '', 200)
  })

  it('passes on the reason a workspace has nothing to complete', async () => {
    const files = indexStub({ entries: [], truncated: false, reason: 'not a git repository' })

    const answer = (await (
      await appWith(files).request('/workspaces/w1/files')
    ).json()) as FileMatches

    expect(answer.reason).toBe('not a git repository')
  })
})
