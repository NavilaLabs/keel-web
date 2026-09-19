import type { AddressInfo } from 'node:net'
import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionKey } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'
import type { SessionRegistry } from '../sessions/types.js'
import type { TranscriptLog } from '../transcript/types.js'
import type { WorkspaceRegistry } from '../workspaces/types.js'
import { createChatRoutes } from './create-chat-routes.js'

/**
 * The one-detach-per-viewer contract only shows itself on a real socket: the
 * in-process Hono harness never resumes the stream handler after an abort, so
 * the paths that can double up are unreachable from there.
 */

const workspace = { id: 'w1', name: 'one', path: '/code', ticketRepository: '/tickets' }

function stubs() {
  let live = 0
  let unsubscribes = 0
  const detaches: number[] = []

  const logger = {
    info: (_fields: unknown, message: unknown) => {
      if (message === 'stream detached') detaches.push(Date.now())
    },
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => logger,
  } as unknown as LoggerVariables['logger']

  const sessions = {
    attach: async (key: SessionKey) => ({ key, sessionId: 's1', pendingPermissions: () => [] }),
    send: async () => undefined,
    answerPermission: async () => true,
    interrupt: async () => undefined,
    subscribe: () => {
      live += 1
      return () => {
        unsubscribes += 1
        live -= 1
      }
    },
    close: async () => undefined,
  } as unknown as SessionRegistry

  const workspaces: WorkspaceRegistry = {
    list: () => [workspace],
    find: (id) => (id === workspace.id ? workspace : undefined),
  }

  // One recorded event, so the stream sends a chunk and the client knows it is open.
  const transcript = {
    append: async () => undefined,
    since: async () => [
      { seq: 1, workspaceId: 'w1', ticketId: '7', type: 'user.message', text: 'a' },
    ],
    lastSequence: async () => 1,
    lastSessionId: async () => undefined,
  } as unknown as TranscriptLog

  return {
    logger,
    sessions,
    workspaces,
    transcript,
    counts: () => ({ live, unsubscribes, detaches: detaches.length }),
  }
}

describe('stream lifecycle on a real socket', () => {
  let server: ServerType
  let port: number
  let harness: ReturnType<typeof stubs>

  beforeEach(async () => {
    harness = stubs()
    const app = new Hono<{ Variables: LoggerVariables }>()
    app.use('*', async (context, next) => {
      context.set('logger', harness.logger)
      await next()
    })
    app.route('/api', createChatRoutes(harness))

    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function openAndLeave(): Promise<void> {
    const client = new AbortController()
    const response = await fetch(`http://127.0.0.1:${port}/api/workspaces/w1/tickets/7/events`, {
      signal: client.signal,
    })
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()
    client.abort()
  }

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  it('detaches a viewer exactly once', async () => {
    await openAndLeave()
    await settle()

    expect(harness.counts()).toEqual({ live: 0, unsubscribes: 1, detaches: 1 })
  })

  it('leaves nothing behind across repeated reloads', async () => {
    for (let reload = 0; reload < 3; reload += 1) {
      await openAndLeave()
      await settle()
    }

    expect(harness.counts()).toEqual({ live: 0, unsubscribes: 3, detaches: 3 })
  })
})
