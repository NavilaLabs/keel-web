import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger, requestLogger, type LoggerVariables } from './logging/index.js'

const app = new Hono<{ Variables: LoggerVariables }>()

app.use(requestLogger)

app.get('/api/health', (c) => c.json({ status: 'ok' }))

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => {
  logger.info(`keel-web server listening on http://localhost:${port}`)
})
