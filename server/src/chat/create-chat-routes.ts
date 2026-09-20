import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ClientCommand, ServerEvent, SessionKey, StreamMessage } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'
import { UnknownWorkspaceError } from '../sessions/types.js'
import type { ChatDependencies, CreateChatRoutes } from './types.js'

function isRecordedEvent(message: StreamMessage): message is ServerEvent {
  return 'seq' in message
}

function parseCommand(body: unknown): ClientCommand | undefined {
  const command = (body as ClientCommand | undefined)?.command
  if (command === 'message') {
    return typeof (body as { text?: unknown }).text === 'string'
      ? (body as ClientCommand)
      : undefined
  }
  if (command === 'permission') {
    const candidate = body as { requestId?: unknown; decision?: unknown }
    const decision = (candidate.decision as { decision?: unknown } | undefined)?.decision
    const known = decision === 'allow' || decision === 'deny' || decision === 'answers'
    return typeof candidate.requestId === 'string' && known ? (body as ClientCommand) : undefined
  }
  if (command === 'interrupt') return body as ClientCommand
  return undefined
}

export const createChatRoutes: CreateChatRoutes = (dependencies: ChatDependencies) => {
  const { sessions, transcript, workspaces } = dependencies
  const routes = new Hono<{ Variables: LoggerVariables }>()

  const keyOf = (context: { req: { param: (name: string) => string } }): SessionKey => ({
    workspaceId: context.req.param('workspaceId'),
    ticketId: context.req.param('ticketId'),
  })

  routes.get('/workspaces/:workspaceId/tickets/:ticketId/events', (context) => {
    const key = keyOf(context)
    const logger = context.get('logger')
    const lastEventId = Number(context.req.header('Last-Event-ID') ?? '0')
    const resumeFrom = Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : 0

    return streamSSE(context, async (stream) => {
      const startedAt = Date.now()
      let eventsSent = 0
      let lastSequence = resumeFrom

      try {
        await sessions.attach(key)
      } catch (error) {
        // Only an unusable workspace lands here. What the agent gets wrong,
        // a missing login included, arrives as a recorded session.failed
        // event once it has had a turn to run.
        await stream.writeSSE({
          event: 'session.failed',
          data: JSON.stringify({
            type: 'session.failed',
            ...key,
            seq: 0,
            code: error instanceof UnknownWorkspaceError ? 'startup_failed' : 'agent_error',
            message: error instanceof Error ? error.message : String(error),
          }),
        })
        logger.warn({ ...key, err: String(error) }, 'stream could not attach a session')
        return
      }

      // Subscribing before the replay closes the gap an event could fall into
      // while the transcript is being read. Buffered events below the replayed
      // high-water mark are dropped as duplicates; deltas are never replayed,
      // so buffered ones are dropped outright.
      const buffered: StreamMessage[] = []
      let live = false

      const send = async (message: StreamMessage) => {
        if (isRecordedEvent(message)) {
          if (message.seq <= lastSequence) return
          lastSequence = message.seq
          await stream.writeSSE({
            event: message.type,
            data: JSON.stringify(message),
            id: String(message.seq),
          })
        } else {
          await stream.writeSSE({ event: message.type, data: JSON.stringify(message) })
        }
        eventsSent += 1
      }

      const unsubscribe = sessions.subscribe(key, (message) => {
        if (!live) {
          buffered.push(message)
          return
        }
        void send(message)
      })

      // Both paths can fire, and the stream's own abort can arrive after the
      // finally block has already run. The contract is one detach per viewer,
      // so the first one wins and the rest are ignored.
      let detached = false
      const detach = () => {
        if (detached) return
        detached = true
        unsubscribe()
      }
      context.req.raw.signal.addEventListener('abort', detach, { once: true })
      stream.onAbort(detach)

      try {
        for (const event of await transcript.since(key, resumeFrom)) {
          await send(event)
        }
        for (const message of buffered) {
          if (isRecordedEvent(message)) await send(message)
        }
        live = true

        logger.info({ ...key, resumeFrom }, 'stream attached')
        await new Promise<void>((resolve) => {
          context.req.raw.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      } finally {
        detach()
        logger.info(
          {
            ...key,
            durationMs: Date.now() - startedAt,
            eventsSent,
            lastEventId: lastSequence,
          },
          'stream detached',
        )
      }
    })
  })

  routes.post('/workspaces/:workspaceId/tickets/:ticketId/input', async (context) => {
    const key = keyOf(context)
    if (workspaces.find(key.workspaceId) === undefined) {
      return context.json({ error: 'Unknown workspace.' }, 404)
    }

    let body: unknown
    try {
      body = await context.req.json()
    } catch {
      return context.json({ error: 'The body is not JSON.' }, 400)
    }

    const command = parseCommand(body)
    if (command === undefined) return context.json({ error: 'Unknown command.' }, 400)

    try {
      if (command.command === 'message') {
        await sessions.send(key, command.text)
      } else if (command.command === 'interrupt') {
        await sessions.interrupt(key)
      } else {
        const answered = await sessions.answerPermission(key, command.requestId, command.decision)
        if (!answered) {
          return context.json({ error: 'That permission request is no longer held.' }, 409)
        }
      }
    } catch (error) {
      context.get('logger').warn({ ...key, err: String(error) }, 'input rejected')
      return context.json({ error: 'This ticket has no session.' }, 404)
    }

    return context.body(null, 204)
  })

  return routes
}
