import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => {
  console.log(`keel-web server listening on http://localhost:${port}`)
})
