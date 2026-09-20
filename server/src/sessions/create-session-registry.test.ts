import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  EffortLevel,
  ModelInfo,
  Options,
  PermissionMode,
  SDKMessage,
  SlashCommand,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  PermissionDecision,
  PermissionRequest,
  SessionControls,
  SessionKey,
  StreamMessage,
} from '@keel-web/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '../logging/types.js'
import { createTranscriptLog } from '../transcript/create-transcript-log.js'
import type { TranscriptLog } from '../transcript/types.js'
import type { WorkspaceRegistry } from '../workspaces/types.js'
import { createSessionRegistry, type RunQuery } from './create-session-registry.js'
import { UnknownWorkspaceError, UnusableSettingsError, type SessionRegistry } from './types.js'

const four: SessionKey = { workspaceId: 'w1', ticketId: '4' }

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

/** One suggestion, as the agent offers it behind an "always allow" choice. */
const rule = {
  type: 'addRules' as const,
  rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }],
  behavior: 'allow' as const,
  destination: 'session' as const,
}

/**
 * A stand-in agent whose output the test drives message by message.
 *
 * Each run keeps its own queue and ends when the registry aborts it, the way a
 * real agent subprocess does, so a resumed session does not read the previous
 * run's messages.
 */
function agentStub({ announceOnFirstMessage = false } = {}) {
  interface Run {
    queued: SDKMessage[]
    wake?: () => void
    finished: boolean
    failure?: Error
    aborted: boolean
  }

  const runs: Run[] = []
  const seen: Options[] = []
  const received: unknown[] = []
  let commands: SlashCommand[] = []
  let models: ModelInfo[] = []
  let catalogueFails = false
  const asked: { model?: string; mode?: string; effort?: EffortLevel | null } = {}
  // Messages emitted before the registry got as far as starting the agent.
  const waiting: SDKMessage[] = []

  const run: RunQuery = (parameters) => {
    seen.push(parameters.options)
    const state: Run = { queued: [...waiting], finished: false, aborted: false }
    waiting.length = 0
    runs.push(state)

    // The real agent produces nothing until a message reaches it, so the stub
    // reads the prompt stream too. With `announceOnFirstMessage` it announces
    // itself only then, which is what the Agent SDK actually does.
    void (async () => {
      for await (const message of parameters.prompt) {
        received.push(message)
        if (announceOnFirstMessage && received.length === 1) {
          state.queued.push(initMessage)
          state.wake?.()
        }
      }
    })()

    parameters.options.abortController?.signal.addEventListener('abort', () => {
      state.aborted = true
      state.wake?.()
    })

    const messages = (async function* () {
      while (true) {
        while (state.queued.length > 0) yield state.queued.shift() as SDKMessage
        if (state.failure !== undefined) throw state.failure
        if (state.finished || state.aborted) return
        await new Promise<void>((resolve) => {
          state.wake = resolve
        })
      }
    })()

    return Object.assign(messages, {
      setModel: (model?: string) => {
        asked.model = model
        return Promise.resolve()
      },
      setPermissionMode: (mode: PermissionMode) => {
        asked.mode = mode
        return Promise.resolve()
      },
      applyFlagSettings: (settings: { effortLevel?: EffortLevel | null }) => {
        asked.effort = settings.effortLevel
        return Promise.resolve()
      },
      supportedCommands: () =>
        catalogueFails ? Promise.reject(new Error('no login')) : Promise.resolve(commands),
      supportedModels: () =>
        catalogueFails ? Promise.reject(new Error('no login')) : Promise.resolve(models),
    }) as unknown as ReturnType<RunQuery>
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
    received: () => received.length,
    offer: (offered: { commands?: SlashCommand[]; models?: ModelInfo[] }) => {
      if (offered.commands !== undefined) commands = offered.commands
      if (offered.models !== undefined) models = offered.models
    },
    asked: () => asked,
    refuseCatalogue: () => {
      catalogueFails = true
    },
  }
}

describe('session registry', () => {
  let ticketRepository: string
  let configDirectory: string
  let transcript: TranscriptLog
  let workspaces: WorkspaceRegistry
  let agent: ReturnType<typeof agentStub>

  function registryWith(): SessionRegistry {
    return createSessionRegistry({
      workspaces,
      configDirectory,
      transcript,
      logger: silentLogger,
      runQuery: agent.run,
    })
  }

  /**
   * A registry whose session has announced itself, which is the state most
   * tests start from. `attach` no longer waits for that, so the test does.
   */
  async function live(): Promise<SessionRegistry> {
    const registry = registryWith()
    await registry.attach(four)
    agent.emit(initMessage)
    await vi.waitFor(async () => expect(await transcript.since(four, 0)).toHaveLength(1))
    return registry
  }

  /** What the PreToolUse hook answers for one call. */
  function preToolUse(input: { tool_name: string; permission_mode?: string }) {
    const hook = agent.options()?.hooks?.PreToolUse?.[0]?.hooks?.[0]
    return hook?.(input as never, undefined, { signal: new AbortController().signal })
  }

  /** Every controls message a viewer would have seen, newest last. */
  function watchControls(registry: SessionRegistry): SessionControls[] {
    const seen: SessionControls[] = []
    registry.subscribe(four, (message) => {
      if (message.type === 'session.controls') seen.push(message.controls)
    })
    return seen
  }

  /** The held request, as the browser learns of it: from the recorded event. */
  async function held(): Promise<PermissionRequest> {
    let request: PermissionRequest | undefined
    await vi.waitFor(async () => {
      const recorded = await transcript.since(four, 1)
      const event = recorded.find((candidate) => candidate.type === 'permission.requested')
      expect(event).toBeDefined()
      request = (event as { request: PermissionRequest }).request
    })
    return request as PermissionRequest
  }

  beforeEach(async () => {
    ticketRepository = await mkdtemp(join(tmpdir(), 'registry-tickets-'))
    configDirectory = await mkdtemp(join(tmpdir(), 'registry-config-'))
    const known = [
      { id: 'w1', name: 'one', path: '/workspaces/keel-web', ticketRepository },
      { id: 'bare', name: 'bare', path: '/elsewhere' },
    ]
    workspaces = {
      list: () => known,
      find: (id) => known.find((workspace) => workspace.id === id),
    }
    transcript = createTranscriptLog(workspaces)
    agent = agentStub()
  })

  it('attaches an agent that has said nothing yet, so the first message can reach it', async () => {
    agent = agentStub({ announceOnFirstMessage: true })
    const registry = registryWith()

    // Neither of these may hang: the agent announces itself when a turn
    // begins, and a turn begins with this very message.
    await registry.attach(four)
    await registry.send(four, 'what is the status')

    await vi.waitFor(() => expect(agent.received()).toBe(1))
    await vi.waitFor(async () =>
      expect(await transcript.since(four, 0)).toContainEqual(
        expect.objectContaining({ type: 'session.started' }),
      ),
    )
  })

  it('does not wait for the agent, however long it stays silent', async () => {
    const registry = registryWith()

    await expect(registry.attach(four)).resolves.toBeUndefined()
    expect(agent.runs()).toBe(1)
  })

  it('reads an agent that gives up before it produced anything as a missing login', async () => {
    const registry = registryWith()
    await registry.attach(four)
    await vi.waitFor(() => expect(agent.runs()).toBe(1))

    agent.fail(new Error('Claude Code process exited with code 1'))

    await vi.waitFor(async () => expect(await transcript.since(four, 0)).toHaveLength(1))
    expect((await transcript.since(four, 0))[0]).toMatchObject({
      type: 'session.failed',
      code: 'auth_required',
    })
  })

  it("keeps the agent's own words in that failure", async () => {
    const registry = registryWith()
    await registry.attach(four)
    await vi.waitFor(() => expect(agent.runs()).toBe(1))

    agent.fail(new Error('Claude Code process exited with code 1'))

    await vi.waitFor(async () => expect(await transcript.since(four, 0)).toHaveLength(1))
    expect((await transcript.since(four, 0))[0]).toMatchObject({
      message: expect.stringContaining('exited with code 1') as string,
    })
  })

  it('starts one agent for concurrent attaches', async () => {
    const registry = registryWith()

    await Promise.all([registry.attach(four), registry.attach(four)])

    expect(agent.runs()).toBe(1)
  })

  it('reuses the running session instead of starting a second one', async () => {
    const registry = await live()

    await registry.attach(four)

    expect(agent.runs()).toBe(1)
  })

  it('resumes a ticket from the session id it remembered', async () => {
    const registry = await live()
    await registry.close(four)

    const second = registry.attach(four)
    agent.emit(initMessage)
    await second

    expect(agent.options()?.resume).toBe('s1')
  })

  it('runs the agent in the code repository', async () => {
    await live()

    expect(agent.options()?.cwd).toBe('/workspaces/keel-web')
  })

  it('records assistant output and hands it to a subscriber', async () => {
    const registry = await live()

    const seen: StreamMessage[] = []
    registry.subscribe(four, (message) => seen.push(message))
    agent.emit({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] },
    } as unknown as SDKMessage)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))

    expect(seen[0]).toMatchObject({ type: 'assistant.message', text: 'hello', seq: 2 })
    expect(await transcript.since(four, 0)).toHaveLength(2)
  })

  it('streams deltas without recording them', async () => {
    const registry = await live()

    const seen: StreamMessage[] = []
    registry.subscribe(four, (message) => seen.push(message))
    agent.emit({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
    } as unknown as SDKMessage)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))

    expect(seen[0]).toEqual({ type: 'assistant.delta', ...four, text: 'hi' })
    expect(await transcript.since(four, 0)).toHaveLength(1)
  })

  it('stops delivering after unsubscribing', async () => {
    const registry = await live()

    const seen: StreamMessage[] = []
    const unsubscribe = registry.subscribe(four, (message) => seen.push(message))
    unsubscribe()
    unsubscribe()
    agent.emit({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'ignored' }] },
    } as unknown as SDKMessage)
    await vi.waitFor(() => expect(transcript.since(four, 0)).resolves.toHaveLength(2))

    expect(seen).toEqual([])
  })

  it('records a message before it reaches the agent', async () => {
    const registry = await live()

    await registry.send(four, 'hello')

    expect(await transcript.since(four, 1)).toMatchObject([{ type: 'user.message', text: 'hello' }])
  })

  it('rejects input for a ticket that has no session', async () => {
    const registry = registryWith()

    await expect(registry.send(four, 'hello')).rejects.toThrow()
  })

  it('reports an unknown permission answer as not held', async () => {
    const registry = await live()

    await expect(registry.answerPermission(four, 'missing', { decision: 'allow' })).resolves.toBe(
      false,
    )
  })

  it('asks the browser before a tool runs, and records both sides', async () => {
    const registry = await live()

    const canUseTool = agent.options()?.canUseTool
    const asking = canUseTool?.('Bash', { command: 'ls' }, {
      signal: new AbortController().signal,
    } as never)

    const request = await held()
    expect(await registry.answerPermission(four, request.requestId, { decision: 'allow' })).toBe(
      true,
    )

    await expect(asking).resolves.toEqual({ behavior: 'allow' })
    const recorded = await transcript.since(four, 1)
    expect(recorded.map((event) => event.type)).toEqual([
      'permission.requested',
      'permission.resolved',
    ])
  })

  it('passes a denial and its reason back to the agent', async () => {
    const registry = await live()

    const asking = agent.options()?.canUseTool?.('Bash', { command: 'rm -rf /' }, {
      signal: new AbortController().signal,
    } as never)
    const decision: PermissionDecision = { decision: 'deny', message: 'not that' }
    await registry.answerPermission(four, (await held()).requestId, decision)

    await expect(asking).resolves.toEqual({ behavior: 'deny', message: 'not that' })
  })

  it('carries structured answers into the tool input', async () => {
    const registry = await live()

    const questions = [
      {
        question: 'Which library?',
        header: 'Library',
        multiSelect: false,
        options: [
          { label: 'A', description: 'the first' },
          { label: 'B', description: 'the second' },
        ],
      },
    ]
    const asking = agent.options()?.canUseTool?.('AskUserQuestion', { questions }, {
      signal: new AbortController().signal,
    } as never)
    const request = await held()
    expect(request.questions).toEqual(questions)
    await registry.answerPermission(four, request.requestId, {
      decision: 'answers',
      answers: { 'Which library?': 'A' },
    })

    await expect(asking).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { questions, answers: { 'Which library?': 'A' } },
    })
  })

  it('asks in its default mode whatever the rules say', async () => {
    await live()

    const decision = await preToolUse({ tool_name: 'Bash', permission_mode: 'default' })

    expect(decision).toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
    })
  })

  it('leaves the call to the agent in any mode but the default one', async () => {
    await live()

    for (const mode of ['auto', 'acceptEdits', 'plan', 'dontAsk']) {
      expect(await preToolUse({ tool_name: 'Edit', permission_mode: mode })).toEqual({})
    }
  })

  it('records a failing agent as an error the UI can show', async () => {
    await live()

    agent.fail(new Error('the agent exploded'))
    await vi.waitFor(async () => expect(await transcript.since(four, 1)).toHaveLength(1))

    expect((await transcript.since(four, 1))[0]).toMatchObject({
      type: 'session.failed',
      code: 'agent_error',
    })
  })

  it('reads a failure after the agent produced something as an agent error, whatever it says', async () => {
    await live()

    agent.fail(new Error('Invalid API key - Please run /login'))
    await vi.waitFor(async () => expect(await transcript.since(four, 1)).toHaveLength(1))

    expect((await transcript.since(four, 1))[0]).toMatchObject({ code: 'agent_error' })
  })

  it('hands the agent the configuration directory it was given', async () => {
    await live()

    expect(agent.options()?.env).toMatchObject({ CLAUDE_CONFIG_DIR: configDirectory })
    expect(agent.options()?.env?.PATH).toBe(process.env.PATH)
  })

  it('denies what is still held when the session closes', async () => {
    const registry = await live()

    const asking = agent.options()?.canUseTool?.('Bash', { command: 'ls' }, {
      signal: new AbortController().signal,
    } as never)
    await held()
    await registry.close(four)

    await expect(asking).resolves.toMatchObject({ behavior: 'deny' })
  })

  it('refuses a workspace that is not registered', async () => {
    const registry = registryWith()

    await expect(registry.attach({ workspaceId: 'gone', ticketId: '4' })).rejects.toBeInstanceOf(
      UnknownWorkspaceError,
    )
    expect(agent.runs()).toBe(0)
  })

  it('refuses a workspace that has no keel configuration', async () => {
    const registry = registryWith()

    await expect(registry.attach({ workspaceId: 'bare', ticketId: '4' })).rejects.toBeInstanceOf(
      UnknownWorkspaceError,
    )
  })

  it('keeps sessions of the same ticket number in different workspaces apart', async () => {
    const registry = registryWith()
    const first = registry.attach(four)
    agent.emit(initMessage)
    await first

    expect(agent.runs()).toBe(1)
    await expect(registry.attach({ workspaceId: 'gone', ticketId: '4' })).rejects.toBeInstanceOf(
      UnknownWorkspaceError,
    )
  })

  it('says what the session offers before a turn has run', async () => {
    agent.offer({
      commands: [{ name: 'review', description: 'Reviews the diff', argumentHint: '<path>' }],
      models: [
        {
          value: 'sonnet',
          displayName: 'Sonnet 5',
          description: 'balanced',
          supportsEffort: true,
          supportedEffortLevels: ['low', 'high'],
        },
      ],
    })
    const registry = registryWith()
    await registry.attach(four)

    const controls = await registry.controls(four)

    expect(controls.settings).toEqual({ mode: 'default' })
    expect(controls.commands).toEqual([
      { name: 'review', description: 'Reviews the diff', argumentHint: '<path>' },
    ])
    expect(controls.models[0]?.effortLevels).toEqual(['low', 'high'])
  })

  it('offers no effort level for a model that has no effort control', async () => {
    agent.offer({
      models: [{ value: 'haiku', displayName: 'Haiku', description: 'quick' }],
    })
    const registry = registryWith()
    await registry.attach(four)

    expect((await registry.controls(four)).models[0]?.effortLevels).toEqual([])
  })

  it('leaves a session usable when the agent will not say what it offers', async () => {
    const registry = registryWith()
    agent.refuseCatalogue()
    await registry.attach(four)

    const controls = await registry.controls(four)

    expect(controls.commands).toEqual([])
    expect(controls.models).toEqual([])
  })

  it('changes the model, the mode and the effort, and says so once', async () => {
    agent.offer({
      models: [
        {
          value: 'opus',
          displayName: 'Opus 5',
          description: 'deep',
          supportsEffort: true,
          supportedEffortLevels: ['high', 'max'],
        },
      ],
    })
    const registry = await live()
    const seen = watchControls(registry)

    await registry.changeControls(four, { mode: 'acceptEdits', model: 'opus', effort: 'max' })

    expect(agent.asked()).toEqual({ mode: 'acceptEdits', model: 'opus', effort: 'max' })
    expect(seen.at(-1)?.settings).toEqual({ mode: 'acceptEdits', model: 'opus', effort: 'max' })
  })

  it('returns the model and the effort to the agent default', async () => {
    agent.offer({
      models: [
        {
          value: 'opus',
          displayName: 'Opus 5',
          description: 'deep',
          supportsEffort: true,
          supportedEffortLevels: ['high'],
        },
      ],
    })
    const registry = await live()
    await registry.changeControls(four, { model: 'opus', effort: 'high' })

    await registry.changeControls(four, { model: null, effort: null })

    expect(agent.asked()).toMatchObject({ model: undefined, effort: null })
    expect((await registry.controls(four)).settings).toEqual({ mode: 'default' })
  })

  it('refuses a model the session was never offered', async () => {
    const registry = await live()

    await expect(registry.changeControls(four, { model: 'gpt' })).rejects.toBeInstanceOf(
      UnusableSettingsError,
    )
  })

  it('refuses an effort the chosen model has no control for', async () => {
    agent.offer({
      models: [
        {
          value: 'haiku',
          displayName: 'Haiku',
          description: 'quick',
          supportsEffort: true,
          supportedEffortLevels: ['low'],
        },
      ],
    })
    const registry = await live()

    await expect(
      registry.changeControls(four, { model: 'haiku', effort: 'max' }),
    ).rejects.toBeInstanceOf(UnusableSettingsError)
    expect(agent.asked().model).toBeUndefined()
  })

  it('replaces the command list when the agent discovers more', async () => {
    const registry = await live()
    const seen = watchControls(registry)

    agent.emit({
      type: 'system',
      subtype: 'commands_changed',
      commands: [{ name: 'deploy', description: 'Ships it', argumentHint: '' }],
    } as unknown as SDKMessage)

    await vi.waitFor(() => expect(seen.at(-1)?.commands).toHaveLength(1))
    expect(seen.at(-1)?.commands[0]?.name).toBe('deploy')
  })

  it('offers to stop asking only where a rule would cover no more than the call', async () => {
    await live()

    void agent.options()?.canUseTool?.('Bash', { command: 'ls' }, {
      signal: new AbortController().signal,
      suggestions: [rule],
      defaultToNo: true,
    } as never)

    const request = await held()
    expect(request.alwaysAllowable).toBe(true)
    expect(request.defaultToNo).toBe(true)
  })

  it('does not offer to stop asking when the agent says the rule grants more', async () => {
    await live()

    void agent.options()?.canUseTool?.('Bash', { command: 'ls' }, {
      signal: new AbortController().signal,
      suggestions: [rule],
      suppressAlwaysAllowRule: true,
    } as never)

    expect((await held()).alwaysAllowable).toBeUndefined()
  })

  it('keeps an always-allow rule inside the session and stops asking for that tool', async () => {
    const registry = await live()

    const asking = agent.options()?.canUseTool?.('Bash', { command: 'ls' }, {
      signal: new AbortController().signal,
      suggestions: [{ ...rule, destination: 'localSettings' }],
    } as never)
    await registry.answerPermission(four, (await held()).requestId, {
      decision: 'allow',
      alwaysAllow: true,
    })

    await expect(asking).resolves.toEqual({
      behavior: 'allow',
      updatedPermissions: [{ ...rule, destination: 'session' }],
      decisionClassification: 'user_permanent',
    })
    expect(await preToolUse({ tool_name: 'Bash', permission_mode: 'default' })).toEqual({})
    expect(await preToolUse({ tool_name: 'Edit', permission_mode: 'default' })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'ask' },
    })
  })

  it('closes an unknown ticket without complaining', async () => {
    const registry = registryWith()

    await expect(registry.close({ workspaceId: 'w1', ticketId: 'nope' })).resolves.toBeUndefined()
    await expect(
      registry.interrupt({ workspaceId: 'w1', ticketId: 'nope' }),
    ).resolves.toBeUndefined()
  })
})
