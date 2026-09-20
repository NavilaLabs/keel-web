import { Hono } from 'hono'
import type { LoggerVariables } from '../logging/types.js'
import {
  UnknownArchitectureViewError,
  UnreadableArchitectureError,
  type CreateArchitectureRoutes,
} from './types.js'

export const createArchitectureRoutes: CreateArchitectureRoutes = ({
  architecture,
  workspaces,
}) => {
  const routes = new Hono<{ Variables: LoggerVariables }>()

  routes.get('/workspaces/:workspaceId/architecture', async (context) => {
    const workspace = workspaces.find(context.req.param('workspaceId'))
    if (!workspace) {
      return context.json({ reason: 'That workspace is not one keel-web knows.' }, 404)
    }

    const view = context.req.query('view')
    if (view === undefined || view === '') {
      return context.json({ reason: 'That request names no view.' }, 400)
    }

    try {
      const answer = await architecture.view(workspace, view, context.req.query('branch'))

      if (context.req.header('if-none-match') === answer.etag) {
        context.header('ETag', answer.etag)
        return context.body(null, 304)
      }

      context.header('ETag', answer.etag)
      return context.json(answer)
    } catch (error) {
      if (error instanceof UnknownArchitectureViewError) {
        return context.json({ reason: error.message }, 404)
      }
      if (error instanceof UnreadableArchitectureError) {
        return context.json({ reason: error.message }, 400)
      }
      throw error
    }
  })

  return routes
}
