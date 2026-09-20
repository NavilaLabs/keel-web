import { Hono } from 'hono'
import type { LoggerVariables } from '../logging/types.js'
import { UnreadableDirectoryError, type CreateDirectoryRoutes } from './types.js'

export const createDirectoryRoutes: CreateDirectoryRoutes = ({ directories }) => {
  const routes = new Hono<{ Variables: LoggerVariables }>()

  routes.get('/directories', async (context) => {
    try {
      return context.json(await directories.list(context.req.query('path')))
    } catch (error) {
      if (error instanceof UnreadableDirectoryError) {
        return context.json({ reason: error.message }, 400)
      }
      throw error
    }
  })

  return routes
}
