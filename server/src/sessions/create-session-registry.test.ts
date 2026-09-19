import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionDecision, StreamMessage } from '@keel-web/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '../logging/types.js'
import { createTranscriptLog } from '../transcript/create-transcript-log.js'
import type { TranscriptLog } from '../transcript/types.js'
import { createSessionRegistry, type RunQuery } from './create-session-registry.js'
import { AuthRequiredError, SessionStartError, type SessionRegistry } from './types.js'

const silentLogger = {
  fatal: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  child: () => silentLogger,
} as unknown as Logger

const initMessage = { type: 'system', subtype: 'init', session_id: 's1' } as unknown as SDKMessage

/**
 * A stand-in agent whose output the test drives message by message.
 *
 * Each run keeps its own queue and ends when the registry aborts it, the way a
 * real agent subprocess does, so a resumed session does not read the previous
 * run's messages.
 */
function agentStub() {
  interface Run {
    queued: SDKMessage[]
    wake?: () => void
    finished: boolean
    failure?: Error
    aborted: boolean
  }

  const runs: Run[] = []
  const seen: Options[] = []
  // Messages emitted before the registry got as far as starting the agent.
  const waiting: SDKMessage[] = []

  const run: RunQuery = (parameters) => {
    seen.push(parameters.options)
    const state: Run = { queued: [...waiting], finished: false, aborted: false }
    waiting.length = 0
    runs.push(state)

    parameters.options.abortController?.signal.addEventListener('abort', () => {
      state.aborted = true
      state.wake?.()
    })

    return (async function* () {
      while (true) {
        while (state.queued.length > 0) yield state.queued.shift() as SDKMessage
        if (state.failure !== undefined) throw state.failure
        if (state.finished || state.aborted) return
        await new Promise<void>((resolve) => {
          state.wake = resolve
        })
      }
    })()
  }

  const current = () =>
    runs.filter((state) => !state.finished && !state.aborted && state.failure === undefined).at(-1)

  return {
    run,
    emit: (message: SDKMessage) => {
      const state = current()
      if (state === undefined) {
        waiting.push(message)
        return
      }
      state.queued.push(message)
      state.wake?.()
    },
    fail: (error: Error) => {
      const state = current()
      if (state !== undefined) {
        state.failure = error
        state.wake?.()
      }
    },
    options: () => seen.at(-1),
    runs: () => runs.length,
  }
}

describe('session registry', () => {
  let dataDirectory: string
  let configDirectory: string
  let transcript: TranscriptLog
  let agent: ReturnType<typeof agentStub>

  async function registryWith(loggedIn = true): Promise<SessionRegistry> {
    if (loggedIn) await writeFile(join(configDirectory, '.credentials.json'), '{}', 'utf8')
    return createSessionRegistry({
      workingDirectory: '/workspaces/keel-web',
      stateDirectory: dataDirectory,
      configDirectory,
      transcript,
      logger: silentLogger,
      startTimeoutMs: 500,
      runQuery: agent.run,
    })
  }

  beforeEach(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'registry-data-'))
    configDirectory = await mkdtemp(join(tmpdir(), 'registry-config-'))
    transcript = createTranscriptLog(join(dataDirectory, 'transcripts'))
    agent = agentStub()
  })

  it('refuses to start when the container has no login', async () => {
    const registry = await registryWith(false)

    await expect(registry.attach('4')).rejects.toBeInstanceOf(AuthRequiredError)
    expect(agent.runs()).toBe(0)
  })

  it('returns the session once the agent reports its id', async () => {
    const registry = await registryWith()

    const attaching = registry.attach('4')
    agent.emit(initMessage)

    await expect(attaching).resolves.toMatchObject({ ticketId: '4', sessionId: 's1' })
  })

  it('gives up when the agent never reports a session', async () => {
    const registry = await registryWith()

    await expect(registry.attach('4')).rejects.toBeInstanceOf(SessionStartError)
  })

  it('starts one agent for concurrent attaches', async () => {
    const registry = await registryWith()

    const both = Promise.all([registry.attach('4'), registry.attach('4')])
    agent.emit(initMessage)
    const [first, second] = await both

    expect(agent.runs()).toBe(1)
    expect(first.sessionId).toBe(second.sessionId)
  })

  it('reuses the running session instead of starting a second one', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    await attaching

    await registry.attach('4')

    expect(agent.runs()).toBe(1)
  })

  it('resumes a ticket from the session id it remembered', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    await attaching
    await registry.close('4')

    const second = registry.attach('4')
    agent.emit(initMessage)
    await second

    expect(agent.options()?.resume).toBe('s1')
  })

  it('runs the agent in the code repository', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    await attaching

    expect(agent.options()?.cwd).toBe('/workspaces/keel-web')
  })

  it('records assistant output and hands it to a subscriber', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    await attaching

    const seen: StreamMessage[] = []
    registry.subscribe('4', (message) => seen.push(message))
    agent.emit({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] },
    } as unknown as SDKMessage)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))

    expect(seen[0]).toMatchObject({ type: 'assistant.message', text: 'hello', seq: 2 })
    expect(await transcript.since('4', 0)).toHaveLength(2)
  })

  it('streams deltas without recording them', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    await attaching

    const seen: StreamMessage[] = []
    registry.subscribe('4', (message) => seen.push(message))
    agent.emit({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
    } as unknown as SDKMessage)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))

    expect(seen[0]).toEqual({ type: 'assistant.delta', ticketId: '4', text: 'hi' })
    expect(await transcript.since('4', 0)).toHaveLength(1)
  })

  it('stops delivering after unsubscribing', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    await attaching

    const seen: StreamMessage[] = []
    const unsubscribe = registry.subscribe('4', (message) => seen.push(message))
    unsubscribe()
    unsubscribe()
    agent.emit({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'ignored' }] },
    } as unknown as SDKMessage)
    await vi.waitFor(() => expect(transcript.since('4', 0)).resolves.toHaveLength(2))

    expect(seen).toEqual([])
  })

  it('records a message before it reaches the agent', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    await attaching

    await registry.send('4', 'hello')

    expect(await transcript.since('4', 1)).toMatchObject([{ type: 'user.message', text: 'hello' }])
  })

  it('rejects input for a ticket that has no session', async () => {
    const registry = await registryWith()

    await expect(registry.send('4', 'hello')).rejects.toThrow()
  })

  it('reports an unknown permission answer as not held', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    await attaching

    await expect(registry.answerPermission('4', 'missing', { decision: 'allow' })).resolves.toBe(
      false,
    )
  })

  it('asks the browser before a tool runs, and records both sides', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    const session = await attaching

    const canUseTool = agent.options()?.canUseTool
    const asking = canUseTool?.('Bash', { command: 'ls' }, {
      signal: new AbortController().signal,
    } as never)

    await vi.waitFor(() => expect(session.pendingPermissions()).toHaveLength(1))
    const [request] = session.pendingPermissions()
    expect(await registry.answerPermission('4', request.requestId, { decision: 'allow' })).toBe(
      true,
    )

    await expect(asking).resolves.toEqual({ behavior: 'allow' })
    const recorded = await transcript.since('4', 1)
    expect(recorded.map((event) => event.type)).toEqual([
      'permission.requested',
      'permission.resolved',
    ])
  })

  it('passes a denial and its reason back to the agent', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    const session = await attaching

    const asking = agent.options()?.canUseTool?.('Bash', { command: 'rm -rf /' }, {
      signal: new AbortController().signal,
    } as never)
    await vi.waitFor(() => expect(session.pendingPermissions()).toHaveLength(1))
    const decision: PermissionDecision = { decision: 'deny', message: 'not that' }
    await registry.answerPermission('4', session.pendingPermissions()[0].requestId, decision)

    await expect(asking).resolves.toEqual({ behavior: 'deny', message: 'not that' })
  })

  it('carries structured answers into the tool input', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    const session = await attaching

    const questions = [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [] }]
    const asking = agent.options()?.canUseTool?.('AskUserQuestion', { questions }, {
      signal: new AbortController().signal,
    } as never)
    await vi.waitFor(() => expect(session.pendingPermissions()).toHaveLength(1))
    const [request] = session.pendingPermissions()
    expect(request.questions).toEqual(questions)
    await registry.answerPermission('4', request.requestId, {
      decision: 'answers',
      answers: { Which: ['A'] },
    })

    await expect(asking).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { questions, answers: { Which: ['A'] } },
    })
  })

  it('asks for every tool call, whatever the rules say', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    await attaching

    const hook = agent.options()?.hooks?.PreToolUse?.[0]?.hooks?.[0]
    const decision = await hook?.({} as never, undefined, { signal: new AbortController().signal })

    expect(decision).toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
    })
  })

  it('records a failing agent as an error the UI can show', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    await attaching

    agent.fail(new Error('the agent exploded'))
    await vi.waitFor(async () => expect(await transcript.since('4', 1)).toHaveLength(1))

    expect((await transcript.since('4', 1))[0]).toMatchObject({
      type: 'session.failed',
      code: 'agent_error',
    })
  })

  it('recognises a lost login in an agent failure', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    await attaching

    agent.fail(new Error('Invalid API key - Please run /login'))
    await vi.waitFor(async () => expect(await transcript.since('4', 1)).toHaveLength(1))

    expect((await transcript.since('4', 1))[0]).toMatchObject({ code: 'auth_required' })
  })

  it('denies what is still held when the session closes', async () => {
    const registry = await registryWith()
    const attaching = registry.attach('4')
    agent.emit(initMessage)
    const session = await attaching

    const asking = agent.options()?.canUseTool?.('Bash', { command: 'ls' }, {
      signal: new AbortController().signal,
    } as never)
    await vi.waitFor(() => expect(session.pendingPermissions()).toHaveLength(1))
    await registry.close('4')

    await expect(asking).resolves.toMatchObject({ behavior: 'deny' })
  })

  it('closes an unknown ticket without complaining', async () => {
    const registry = await registryWith()

    await expect(registry.close('nope')).resolves.toBeUndefined()
    await expect(registry.interrupt('nope')).resolves.toBeUndefined()
  })
})
