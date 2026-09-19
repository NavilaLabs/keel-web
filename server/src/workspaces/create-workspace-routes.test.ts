import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceSummary } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'
import { createWorkspaceRoutes, summarise } from './create-workspace-routes.js'
import { NotADirectoryError, type Workspace, type WorkspaceRegistry } from './types.js'

const ready: Workspace = {
  id: 'w1',
  name: 'one',
  path: '/code/one',
  reachable: true,
  ticketRepository: '/tickets/one',
  tracker: { source: 'github', repository: 'Org/one' },
}

function registryStub(overrides: Partial<WorkspaceRegistry> = {}): WorkspaceRegistry {
  return {
    list: () => [ready],
    find: () => ready,
    add: vi.fn(async () => [ready]),
    remove: vi.fn(async () => []),
    refresh: vi.fn(async () => [ready]),
    ...overrides,
  }
}

function appWith(workspaces: WorkspaceRegistry) {
  const app = new Hono<{ Variables: LoggerVariables }>()
  app.route('/api', createWorkspaceRoutes({ workspaces }))
  return app
}

function post(workspaces: WorkspaceRegistry, body: unknown) {
  return appWith(workspaces).request('/api/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('summarising a workspace', () => {
  it('calls a reachable repository with a ticket repository ready', () => {
    expect(summarise(ready)).toEqual({
      id: 'w1',
      name: 'one',
      path: '/code/one',
      state: 'ready',
      ticketRepository: '/tickets/one',
      tracker: { source: 'github', repository: 'Org/one' },
    })
  })

  it('calls a repository without a ticket repository unconfigured, whatever its tracker says', () => {
    const summary = summarise({
      ...ready,
      ticketRepository: undefined,
      tracker: { source: 'github', repository: 'Org/one' },
    })

    expect(summary.state).toBe('unconfigured')
  })

  it('says a vanished path is unreachable without guessing at its configuration', () => {
    const summary = summarise({ ...ready, reachable: false })

    expect(summary.state).toBe('unreachable')
    expect(summary).not.toHaveProperty('ticketRepository')
  })

  it('names the directory in the reason, so the sentence is about this repository', () => {
    const summary = summarise({ ...ready, reachable: false })

    expect(summary.state === 'unreachable' && summary.reason).toContain('/code/one')
  })
})

describe('workspace routes', () => {
  it('refreshes before listing, so a vanished path shows as one', async () => {
    const workspaces = registryStub()

    const response = await appWith(workspaces).request('/api/workspaces')

    expect(response.status).toBe(200)
    expect(workspaces.refresh).toHaveBeenCalled()
    expect(((await response.json()) as WorkspaceSummary[])[0].state).toBe('ready')
  })

  it('answers an addition with the whole new list', async () => {
    const workspaces = registryStub()

    const response = await post(workspaces, { path: '/code/one' })

    expect(response.status).toBe(201)
    expect((await response.json()) as WorkspaceSummary[]).toHaveLength(1)
    expect(workspaces.add).toHaveBeenCalledWith('/code/one')
  })

  it('trims the path before adding it', async () => {
    const workspaces = registryStub()

    await post(workspaces, { path: '  /code/one  ' })

    expect(workspaces.add).toHaveBeenCalledWith('/code/one')
  })

  it('passes on the reason a path was refused', async () => {
    const workspaces = registryStub({
      add: vi.fn(() => Promise.reject(new NotADirectoryError('There is nothing at /nope.'))),
    })

    const response = await post(workspaces, { path: '/nope' })

    expect(response.status).toBe(400)
    expect((await response.json()) as { reason: string }).toEqual({
      reason: 'There is nothing at /nope.',
    })
  })

  it('refuses a body without a path', async () => {
    expect((await post(registryStub(), {})).status).toBe(400)
    expect((await post(registryStub(), { path: '   ' })).status).toBe(400)
    expect((await post(registryStub(), 'not json')).status).toBe(400)
  })

  it('answers a removal with the whole new list', async () => {
    const workspaces = registryStub()

    const response = await appWith(workspaces).request('/api/workspaces/w1', { method: 'DELETE' })

    expect(response.status).toBe(200)
    expect((await response.json()) as WorkspaceSummary[]).toEqual([])
    expect(workspaces.remove).toHaveBeenCalledWith('w1')
  })
})
