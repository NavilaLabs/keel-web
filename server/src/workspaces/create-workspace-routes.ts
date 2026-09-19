import { Hono } from 'hono'
import type { WorkspaceSummary } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'
import {
  NotADirectoryError,
  type CreateWorkspaceRoutes,
  type SummariseWorkspace,
  type Workspace,
} from './types.js'

export const summarise: SummariseWorkspace = (workspace: Workspace): WorkspaceSummary => {
  const common = { id: workspace.id, name: workspace.name, path: workspace.path }

  if (!workspace.reachable) {
    return { ...common, state: 'unreachable', reason: `Nothing is at ${workspace.path} any more.` }
  }
  if (workspace.ticketRepository === undefined) {
    return {
      ...common,
      state: 'unconfigured',
      reason: 'No .claude/keel.json here, so keel does not know where its tickets live.',
    }
  }
  return {
    ...common,
    state: 'ready',
    ticketRepository: workspace.ticketRepository,
    ...(workspace.tracker !== undefined && { tracker: workspace.tracker }),
  }
}

export const createWorkspaceRoutes: CreateWorkspaceRoutes = ({ workspaces }) => {
  const routes = new Hono<{ Variables: LoggerVariables }>()

  routes.get('/workspaces', async (context) =>
    context.json((await workspaces.refresh()).map(summarise)),
  )

  routes.post('/workspaces', async (context) => {
    const body = (await context.req.json().catch(() => undefined)) as { path?: unknown } | undefined
    const path = body?.path
    if (typeof path !== 'string' || path.trim() === '') {
      return context.json({ reason: 'Name a path to add.' }, 400)
    }

    try {
      const listed = await workspaces.add(path.trim())
      return context.json(listed.map(summarise), 201)
    } catch (error) {
      if (error instanceof NotADirectoryError) {
        return context.json({ reason: error.message }, 400)
      }
      throw error
    }
  })

  routes.delete('/workspaces/:id', async (context) =>
    context.json((await workspaces.remove(context.req.param('id'))).map(summarise)),
  )

  return routes
}
