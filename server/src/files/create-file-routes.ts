import { Hono } from 'hono'
import type { LoggerVariables } from '../logging/types.js'
import type { CreateFileRoutes, FileDependencies } from './types.js'

/** Small, because this answers a popup rather than a file browser. */
const defaultLimit = 20
const mostEver = 200

export const createFileRoutes: CreateFileRoutes = (dependencies: FileDependencies) => {
  const { files, workspaces } = dependencies
  const routes = new Hono<{ Variables: LoggerVariables }>()

  routes.get('/workspaces/:workspaceId/files', async (context) => {
    const workspaceId = context.req.param('workspaceId')
    if (workspaces.find(workspaceId) === undefined) {
      return context.json({ error: 'Unknown workspace.' }, 404)
    }

    const asked = context.req.query('limit')
    const limit = asked === undefined ? defaultLimit : Number(asked)
    if (!Number.isInteger(limit) || limit <= 0) {
      return context.json({ error: 'The limit has to be a positive whole number.' }, 400)
    }

    const query = context.req.query('query') ?? ''
    return context.json(await files.matches(workspaceId, query, Math.min(limit, mostEver)))
  })

  return routes
}
