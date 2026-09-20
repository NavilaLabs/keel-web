import { homedir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createArchitectureReader, createArchitectureRoutes } from './architecture/index.js'
import { createArtifactReader, createArtifactRoutes } from './artifacts/index.js'
import { createChatRoutes } from './chat/index.js'
import { createHintFollower, createHintRoutes } from './hints/index.js'
import { createDirectoryBrowser, createDirectoryRoutes } from './directories/index.js'
import { createFileIndex, createFileRoutes } from './files/index.js'
import { logger, requestLogger, type LoggerVariables } from './logging/index.js'
import { createHostGuard } from './security/index.js'
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

const architecture = createArchitectureReader()
const hints = createHintFollower()
const artifacts = createArtifactReader({ architecture })

const additionalHosts = (process.env.KEEL_WEB_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter((host) => host !== '')

const app = new Hono<{ Variables: LoggerVariables }>()

app.use(requestLogger)
app.use(createHostGuard({ additionalHosts }))

app.get('/api/health', (c) => c.json({ status: 'ok' }))
app.route('/api', createWorkspaceRoutes({ workspaces }))
app.route('/api', createDirectoryRoutes({ directories: createDirectoryBrowser() }))
app.route('/api', createChatRoutes({ sessions, transcript, workspaces }))
app.route('/api', createArtifactRoutes({ artifacts, workspaces }))
app.route('/api', createArchitectureRoutes({ architecture, workspaces }))
app.route('/api', createHintRoutes({ hints, workspaces }))
app.route('/api', createFileRoutes({ files: createFileIndex({ workspaces, logger }), workspaces }))

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
