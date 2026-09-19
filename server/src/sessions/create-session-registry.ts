import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import {
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  PermissionDecision,
  PermissionRequest,
  Question,
  SessionKey,
  StreamMessage,
} from '@keel-web/protocol'
import type { Logger } from '../logging/types.js'
import { createPermissionGate } from '../permissions/index.js'
import type { PermissionGate } from '../permissions/types.js'
import type { TranscriptLog } from '../transcript/types.js'
import type { WorkspaceRegistry } from '../workspaces/types.js'
import { deltaTextOf, normalise } from './normalise.js'
import {
  AuthRequiredError,
  SessionStartError,
  UnknownWorkspaceError,
  type Session,
  type SessionRegistry,
  type Unsubscribe,
} from './types.js'

/**
 * Starts an agent run.
 *
 * Narrower than the SDK's own `query`, which returns a generator with control
 * methods the registry does not use: it drives the run through its own
 * `AbortController` instead.
 */
export type RunQuery = (parameters: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => AsyncIterable<SDKMessage>

export interface SessionRegistryOptions {
  /** Resolves a workspace to the repository an agent runs in. */
  workspaces: WorkspaceRegistry
  /** Claude Code's configuration directory, holding the credentials. */
  configDirectory: string
  transcript: TranscriptLog
  logger: Logger
  /** Milliseconds to wait for the agent to report its session id. */
  startTimeoutMs?: number
  /** The agent runner. Injected so the registry can be driven without a real agent. */
  runQuery?: RunQuery
}

interface SessionState {
  key: SessionKey
  sessionId: string
  gate: PermissionGate
  listeners: Set<(message: StreamMessage) => void>
  input: InputQueue
  abort: AbortController
  logger: Logger
}

interface InputQueue {
  push: (text: string) => void
  close: () => void
  stream: AsyncGenerator<SDKUserMessage>
}

const authenticationHints = ['/login', 'invalid api key', 'not logged in', 'unauthorized']

function createInputQueue(): InputQueue {
  const waiting: string[] = []
  let wake: (() => void) | undefined
  let closed = false

  async function* stream(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (waiting.length > 0) {
        const text = waiting.shift() as string
        yield {
          type: 'user',
          message: { role: 'user', content: text },
          parent_tool_use_id: null,
        }
      }
      if (closed) return
      await new Promise<void>((resolve) => {
        wake = resolve
      })
      wake = undefined
    }
  }

  return {
    push(text) {
      waiting.push(text)
      wake?.()
    },
    close() {
      closed = true
      wake?.()
    },
    stream: stream(),
  }
}

/** The questions of an AskUserQuestion call, or undefined for any other tool. */
function questionsOf(toolName: string, input: Record<string, unknown>): Question[] | undefined {
  if (toolName !== 'AskUserQuestion') return undefined
  const questions = input.questions
  return Array.isArray(questions) ? (questions as Question[]) : undefined
}

function looksLikeAuthenticationFailure(text: string): boolean {
  const lowered = text.toLowerCase()
  return authenticationHints.some((hint) => lowered.includes(hint))
}

function identity(key: SessionKey): string {
  return `${key.workspaceId}/${key.ticketId}`
}

export function createSessionRegistry(options: SessionRegistryOptions): SessionRegistry {
  const { workspaces, configDirectory, transcript, logger } = options
  const startTimeoutMs = options.startTimeoutMs ?? 60_000
  const runQuery = options.runQuery ?? query

  const sessions = new Map<string, SessionState>()
  const starting = new Map<string, Promise<SessionState>>()

  /** The repository the agent runs in, or a rejection. */
  function repositoryOf(key: SessionKey): string {
    const workspace = workspaces.find(key.workspaceId)
    if (workspace === undefined) {
      throw new UnknownWorkspaceError(`No workspace is registered as ${key.workspaceId}.`)
    }
    if (workspace.ticketRepository === undefined) {
      throw new UnknownWorkspaceError(
        `Workspace ${workspace.name} has no keel configuration, so it cannot hold a session.`,
      )
    }
    return workspace.path
  }

  async function assertLoggedIn(): Promise<void> {
    try {
      await access(join(configDirectory, '.credentials.json'))
    } catch {
      throw new AuthRequiredError(
        'Claude Code is not logged in inside the container. Run `claude` in it once.',
      )
    }
  }

  function broadcast(state: SessionState, message: StreamMessage): void {
    for (const listener of state.listeners) listener(message)
  }

  async function record(
    state: SessionState,
    body: Parameters<TranscriptLog['append']>[1],
  ): Promise<void> {
    broadcast(state, await transcript.append(state.key, body))
  }

  function permissionResultOf(
    decision: PermissionDecision,
    input: Record<string, unknown>,
  ):
    | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
    | {
        behavior: 'deny'
        message: string
      } {
    if (decision.decision === 'deny') return { behavior: 'deny', message: decision.message }
    if (decision.decision === 'answers') {
      return { behavior: 'allow', updatedInput: { ...input, answers: decision.answers } }
    }
    return { behavior: 'allow' }
  }

  function optionsFor(
    state: SessionState,
    repository: string,
    resume: string | undefined,
  ): Options {
    return {
      cwd: repository,
      resume,
      includePartialMessages: true,
      abortController: state.abort,
      stderr: (data) => {
        state.logger.warn({ stderr: data.trim() }, 'agent stderr')
      },
      // Runs before every tool call, whatever the rules and the mode say, so
      // that nothing can be approved without the browser having seen it.
      hooks: {
        PreToolUse: [
          {
            hooks: [
              () =>
                Promise.resolve({
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'ask' as const,
                    permissionDecisionReason: 'keel-web asks the developer in the browser',
                  },
                }),
            ],
          },
        ],
      },
      canUseTool: async (toolName, input, { signal }) => {
        const request: PermissionRequest = {
          requestId: randomUUID(),
          toolName,
          input,
          ...(questionsOf(toolName, input) !== undefined && {
            questions: questionsOf(toolName, input),
          }),
        }
        await record(state, { type: 'permission.requested', request })
        const decision = await state.gate.hold(request, signal)
        await record(state, {
          type: 'permission.resolved',
          requestId: request.requestId,
          decision,
        })
        return permissionResultOf(decision, input)
      },
    }
  }

  async function start(key: SessionKey): Promise<SessionState> {
    const repository = repositoryOf(key)
    await assertLoggedIn()

    const state: SessionState = {
      key,
      sessionId: '',
      gate: createPermissionGate(),
      listeners: new Set(),
      input: createInputQueue(),
      abort: new AbortController(),
      logger: logger.child({ ...key }),
    }

    const resume = await transcript.lastSessionId(key)
    const run = runQuery({
      prompt: state.input.stream,
      options: optionsFor(state, repository, resume),
    })

    let announce: ((sessionId: string) => void) | undefined
    let fail: ((error: Error) => void) | undefined
    const ready = new Promise<string>((resolve, reject) => {
      announce = resolve
      fail = reject
    })

    void (async () => {
      try {
        for await (const message of run) {
          const delta = deltaTextOf(message)
          if (delta !== undefined) {
            broadcast(state, { type: 'assistant.delta', ...key, text: delta })
            continue
          }
          for (const body of normalise(message)) {
            if (body.type === 'session.started') {
              state.sessionId = body.sessionId
              await record(state, { ...body, resumed: resume !== undefined })
              announce?.(body.sessionId)
              continue
            }
            await record(state, body)
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const authentication = looksLikeAuthenticationFailure(message)
        state.logger.error({ err: message }, 'agent session ended with an error')
        await record(state, {
          type: 'session.failed',
          code: authentication ? 'auth_required' : 'agent_error',
          message: authentication
            ? 'Claude Code is not logged in inside the container. Run `claude` in it once.'
            : message,
        })
        fail?.(authentication ? new AuthRequiredError(message) : new SessionStartError(message))
      } finally {
        state.gate.close()
        sessions.delete(identity(key))
      }
    })()

    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new SessionStartError('The agent did not report a session in time.')),
        startTimeoutMs,
      )
      timer.unref()
    })

    await Promise.race([ready, timeout])
    sessions.set(identity(key), state)
    state.logger.info(
      { sessionId: state.sessionId, resumed: resume !== undefined },
      'session ready',
    )
    return state
  }

  function toSession(state: SessionState): Session {
    return {
      key: state.key,
      sessionId: state.sessionId,
      pendingPermissions: () => state.gate.pending(),
    }
  }

  function sessionFor(key: SessionKey): SessionState {
    const state = sessions.get(identity(key))
    if (state === undefined) throw new Error(`No session for ${identity(key)}.`)
    return state
  }

  return {
    async attach(key) {
      const id = identity(key)
      const running = sessions.get(id)
      if (running !== undefined) return toSession(running)

      const inFlight = starting.get(id)
      if (inFlight !== undefined) return toSession(await inFlight)

      const attempt = start(key).finally(() => starting.delete(id))
      starting.set(id, attempt)
      return toSession(await attempt)
    },

    async send(key, text) {
      const state = sessionFor(key)
      await record(state, { type: 'user.message', text })
      state.input.push(text)
    },

    answerPermission(key, requestId, decision) {
      return Promise.resolve(sessionFor(key).gate.answer(requestId, decision))
    },

    async interrupt(key) {
      const state = sessions.get(identity(key))
      if (state === undefined) return
      state.abort.abort()
    },

    subscribe(key, listener): Unsubscribe {
      const state = sessionFor(key)
      state.listeners.add(listener)
      return () => {
        state.listeners.delete(listener)
      }
    },

    async close(key) {
      const state = sessions.get(identity(key))
      if (state === undefined) return
      state.gate.close()
      state.input.close()
      state.abort.abort()
      sessions.delete(identity(key))
      state.logger.info('session closed')
    },
  }
}
