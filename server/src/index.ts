import { homedir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createChatRoutes } from './chat/index.js'
import { logger, requestLogger, type LoggerVariables } from './logging/index.js'
import { createSessionRegistry } from './sessions/index.js'
import { createTranscriptLog } from './transcript/index.js'

const dataDirectory = process.env.KEEL_WEB_DATA_DIR ?? join(homedir(), '.local/share/keel-web')
const workingDirectory = process.env.KEEL_WEB_WORKING_DIR ?? process.cwd()
const configDirectory = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')

const transcript = createTranscriptLog(join(dataDirectory, 'transcripts'))
const sessions = createSessionRegistry({
  workingDirectory,
  stateDirectory: dataDirectory,
  configDirectory,
  transcript,
  logger,
})

const app = new Hono<{ Variables: LoggerVariables }>()

app.use(requestLogger)

app.get('/api/health', (c) => c.json({ status: 'ok' }))
app.route('/api', createChatRoutes({ sessions, transcript }))

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => {
  logger.info(`keel-web server listening on http://localhost:${port}`)
})
