import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { PermissionDecision, ServerEvent, SessionKey } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'
import { UnusableSettingsError, type SessionRegistry } from '../sessions/types.js'
import type { TranscriptLog } from '../transcript/types.js'
import type { Workspace, WorkspaceRegistry } from '../workspaces/types.js'
import { createChatRoutes } from './create-chat-routes.js'

const four: SessionKey = { workspaceId: 'w1', ticketId: '4' }
const known: Workspace[] = [{ id: 'w1', name: 'one', path: '/code', ticketRepository: '/tickets' }]

function workspaceStub(workspaces: Workspace[] = known): WorkspaceRegistry {
  return {
    list: () => workspaces,
    find: (id) => workspaces.find((workspace) => workspace.id === id),
  }
}

function registryStub(overrides: Partial<SessionRegistry> = {}): SessionRegistry {
  return {
    attach: vi.fn(async (key: SessionKey) => ({
      key,
      sessionId: 's1',
      pendingPermissions: () => [],
    })),
    send: vi.fn(async () => undefined),
    controls: vi.fn(async () => ({
      settings: { mode: 'default' as const },
      models: [],
      commands: [],
    })),
    changeControls: vi.fn(async () => undefined),
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

function appWith(
  sessions: SessionRegistry,
  transcript = transcriptStub(),
  workspaces = workspaceStub(),
) {
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
  app.route('/', createChatRoutes({ sessions, transcript, workspaces }))
  return app
}

function postInput(sessions: SessionRegistry, body: unknown) {
  return appWith(sessions).request('/workspaces/w1/tickets/4/input', {
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
    expect(sessions.send).toHaveBeenCalledWith(four, 'hello')
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

  it('refuses a workspace it does not know', async () => {
    const app = appWith(registryStub())

    const response = await app.request('/workspaces/gone/tickets/4/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'interrupt' }),
    })

    expect(response.status).toBe(404)
  })

  it('takes a change to what the session runs with', async () => {
    const sessions = registryStub()

    const response = await postInput(sessions, {
      command: 'settings',
      change: { mode: 'acceptEdits', model: 'opus', effort: null },
    })

    expect(response.status).toBe(204)
    expect(sessions.changeControls).toHaveBeenCalledWith(four, {
      mode: 'acceptEdits',
      model: 'opus',
      effort: null,
    })
  })

  it('reads a mode keel-web does not offer as malformed, so naming it reaches nothing', async () => {
    const sessions = registryStub()

    for (const mode of ['bypassPermissions', 'whatever']) {
      const response = await postInput(sessions, { command: 'settings', change: { mode } })
      expect(response.status).toBe(400)
    }
    expect(sessions.changeControls).not.toHaveBeenCalled()
  })

  it('takes every mode keel-web offers', async () => {
    const sessions = registryStub()

    for (const mode of ['default', 'auto', 'acceptEdits', 'dontAsk', 'plan']) {
      const response = await postInput(sessions, { command: 'settings', change: { mode } })
      expect(response.status).toBe(204)
    }
  })

  it('answers 409 when the session cannot run with what was asked for', async () => {
    const sessions = registryStub({
      changeControls: vi.fn(async () => {
        throw new UnusableSettingsError('This session cannot run on gpt.')
      }),
    })

    const response = await postInput(sessions, { command: 'settings', change: { model: 'gpt' } })

    expect(response.status).toBe(409)
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
      { seq: 1, ...four, type: 'user.message', text: 'a' },
      { seq: 2, ...four, type: 'assistant.message', text: 'b' },
    ]
    const app = appWith(registryStub(), transcriptStub(recorded))

    const body = await readStream(app, '/workspaces/w1/tickets/4/events', { 'Last-Event-ID': '1' })

    expect(body).toContain('id: 2')
    expect(body).not.toContain('"seq":1')
  })

  it('tells a viewer what the session runs with, which no replay would', async () => {
    const sessions = registryStub({
      controls: vi.fn(async () => ({
        settings: { mode: 'acceptEdits' as const },
        models: [],
        commands: [{ name: 'review', description: 'Reviews the diff', argumentHint: '' }],
      })),
    })
    const app = appWith(sessions)

    const body = await readStream(app, '/workspaces/w1/tickets/4/events')

    expect(body).toContain('event: session.controls')
    expect(body).toContain('"mode":"acceptEdits"')
    // Not part of the record, so it carries no sequence number and a replay
    // would never bring it back.
    expect(body).not.toContain('id: ')
  })

  it('reports a failed attach as an event instead of a broken stream', async () => {
    const sessions = registryStub({
      attach: vi.fn(() => Promise.reject(new Error('no login'))),
    })
    const app = appWith(sessions)

    const body = await (await app.request('/workspaces/w1/tickets/4/events')).text()

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

    const response = await app.request('/workspaces/w1/tickets/4/events')
    await waitFor(() => order.length === 2)
    await response.body?.cancel()

    expect(order).toEqual(['subscribe', 'since'])
  })
})
