import { homedir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createChatRoutes } from './chat/index.js'
import { createDirectoryBrowser, createDirectoryRoutes } from './directories/index.js'
import { logger, requestLogger, type LoggerVariables } from './logging/index.js'
import { createSessionRegistry } from './sessions/index.js'
import { createTranscriptLog } from './transcript/index.js'
import {
  createWorkspaceRegistry,
  createWorkspaceRoutes,
  createWorkspaceStore,
} from './workspaces/index.js'

const configDirectory = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')

const workspaces = await createWorkspaceRegistry(createWorkspaceStore())
const transcript = createTranscriptLog(workspaces)
const sessions = createSessionRegistry({ workspaces, configDirectory, transcript, logger })

const app = new Hono<{ Variables: LoggerVariables }>()

app.use(requestLogger)

app.get('/api/health', (c) => c.json({ status: 'ok' }))
app.route('/api', createWorkspaceRoutes({ workspaces }))
app.route('/api', createDirectoryRoutes({ directories: createDirectoryBrowser() }))
app.route('/api', createChatRoutes({ sessions, transcript, workspaces }))

const port = Number(process.env.PORT ?? 3000)

// The literal address, not 'localhost', so the binding cannot land on ::1
// alone. Reaching this server means reaching an agent that runs as the
// developer over their whole filesystem, so it stays on this machine.
const hostname = '127.0.0.1'

serve({ fetch: app.fetch, port, hostname }, () => {
  logger.info(
    { workspaces: workspaces.list().length },
    `keel-web server listening on http://${hostname}:${port}`,
  )
})
