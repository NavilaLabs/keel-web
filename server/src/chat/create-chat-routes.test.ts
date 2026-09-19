import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { PermissionDecision, ServerEvent, TicketId } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'
import type { SessionRegistry } from '../sessions/types.js'
import type { TranscriptLog } from '../transcript/types.js'
import { createChatRoutes } from './create-chat-routes.js'

function registryStub(overrides: Partial<SessionRegistry> = {}): SessionRegistry {
  return {
    attach: vi.fn(async (ticketId: TicketId) => ({
      ticketId,
      sessionId: 's1',
      pendingPermissions: () => [],
    })),
    send: vi.fn(async () => undefined),
    answerPermission: vi.fn(async () => true),
    interrupt: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  }
}

function transcriptStub(events: ServerEvent[] = []): TranscriptLog {
  return {
    append: vi.fn(),
    since: vi.fn(async (_ticketId, afterSeq) => events.filter((event) => event.seq > afterSeq)),
    lastSequence: vi.fn(async () => events.at(-1)?.seq ?? 0),
  } as unknown as TranscriptLog
}

function appWith(sessions: SessionRegistry, transcript = transcriptStub()) {
  const app = new Hono<{ Variables: LoggerVariables }>()
  const silent = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => silent,
  } as unknown as LoggerVariables['logger']

  app.use('*', async (context, next) => {
    context.set('logger', silent)
    await next()
  })
  app.route('/', createChatRoutes({ sessions, transcript }))
  return app
}

function postInput(sessions: SessionRegistry, body: unknown) {
  return appWith(sessions).request('/tickets/4/input', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/**
 * Reads the first chunks of an open stream and then closes it.
 *
 * The route keeps the stream open until the client goes away, so a plain
 * `text()` would never resolve.
 */
async function readStream(
  app: Hono<{ Variables: LoggerVariables }>,
  path: string,
  headers: Record<string, string> = {},
  chunks = 1,
): Promise<string> {
  const response = await app.request(path, { headers })
  const body = response.body
  if (body === null) return ''

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (let read = 0; read < chunks; read += 1) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  await reader.cancel()
  return text
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('chat input endpoint', () => {
  it('accepts a message', async () => {
    const sessions = registryStub()

    const response = await postInput(sessions, { command: 'message', text: 'hello' })

    expect(response.status).toBe(204)
    expect(sessions.send).toHaveBeenCalledWith('4', 'hello')
  })

  it('rejects a body that is not JSON', async () => {
    expect((await postInput(registryStub(), 'not json')).status).toBe(400)
  })

  it('rejects an unknown command', async () => {
    expect((await postInput(registryStub(), { command: 'launch' })).status).toBe(400)
  })

  it('rejects a message without text', async () => {
    expect((await postInput(registryStub(), { command: 'message' })).status).toBe(400)
  })

  it('answers 409 when the permission request is no longer held', async () => {
    const sessions = registryStub({ answerPermission: vi.fn(async () => false) })
    const decision: PermissionDecision = { decision: 'allow' }

    const response = await postInput(sessions, {
      command: 'permission',
      requestId: 'r1',
      decision,
    })

    expect(response.status).toBe(409)
  })

  it('answers 404 when the ticket has no session', async () => {
    const sessions = registryStub({
      send: vi.fn(() => Promise.reject(new Error('Ticket 4 has no session.'))),
    })

    expect((await postInput(sessions, { command: 'message', text: 'hi' })).status).toBe(404)
  })

  it('never starts a session from the input endpoint', async () => {
    const sessions = registryStub()

    await postInput(sessions, { command: 'interrupt' })

    expect(sessions.attach).not.toHaveBeenCalled()
  })
})

describe('chat event stream', () => {
  it('replays the transcript before going live', async () => {
    const recorded: ServerEvent[] = [
      { seq: 1, ticketId: '4', type: 'user.message', text: 'a' },
      { seq: 2, ticketId: '4', type: 'assistant.message', text: 'b' },
    ]
    const app = appWith(registryStub(), transcriptStub(recorded))

    const body = await readStream(app, '/tickets/4/events', { 'Last-Event-ID': '1' })

    expect(body).toContain('id: 2')
    expect(body).not.toContain('"seq":1')
  })

  it('reports a failed attach as an event instead of a broken stream', async () => {
    const sessions = registryStub({
      attach: vi.fn(() => Promise.reject(new Error('no login'))),
    })
    const app = appWith(sessions)

    const body = await (await app.request('/tickets/4/events')).text()

    expect(body).toContain('session.failed')
  })

  it('subscribes before reading the transcript, so no event falls in between', async () => {
    const order: string[] = []
    const sessions = registryStub({
      subscribe: vi.fn(() => {
        order.push('subscribe')
        return () => undefined
      }),
    })
    const transcript = transcriptStub()
    transcript.since = vi.fn(() => {
      order.push('since')
      return Promise.resolve([])
    })
    const app = appWith(sessions, transcript)

    const response = await app.request('/tickets/4/events')
    await waitFor(() => order.length === 2)
    await response.body?.cancel()

    expect(order).toEqual(['subscribe', 'since'])
  })
})
