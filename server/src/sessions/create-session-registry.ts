import { randomUUID } from 'node:crypto'
import { query, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
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
import { deltaTextOf, normalise } from './normalise.js'
import {
  UnknownWorkspaceError,
  type RunQuery,
  type SessionRegistry,
  type SessionRegistryOptions,
  type Unsubscribe,
} from './types.js'

export type { RunQuery, SessionRegistryOptions }

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

/**
 * What the developer is told when the agent never reached readiness.
 *
 * The agent's own output is kept, because a missing login is only the
 * likeliest cause of an early exit, not the certain one.
 */
function notReadyMessage(output: string): string {
  return (
    'Claude Code gave up before it was ready, most likely because it has no login. ' +
    `The agent said: ${output}`
  )
}

function identity(key: SessionKey): string {
  return `${key.workspaceId}/${key.ticketId}`
}

export function createSessionRegistry(options: SessionRegistryOptions): SessionRegistry {
  const { workspaces, configDirectory, transcript, logger } = options
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
      // Replaces the child's environment rather than extending it, so the
      // server's own has to be spread in first. Passing the directory here is
      // what keeps agent and server on the same one.
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDirectory },
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

    // Registered before the run produces anything, because the agent only
    // announces itself once a turn begins and a turn begins with a message
    // through `send`, which needs this entry to exist.
    sessions.set(identity(key), state)
    let produced = false

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
              produced = true
              await record(state, { ...body, resumed: resume !== undefined })
              state.logger.info(
                { sessionId: body.sessionId, resumed: resume !== undefined },
                'session ready',
              )
              continue
            }
            produced = true
            await record(state, body)
          }
        }
      } catch (error) {
        const output = error instanceof Error ? error.message : String(error)
        state.logger.error({ err: output }, 'agent session ended with an error')
        // An agent that never produced anything never authenticated, so far
        // as this process can tell. One that did and then failed is a running
        // session that died, which is a different thing entirely.
        if (produced) {
          await record(state, { type: 'session.failed', code: 'agent_error', message: output })
        } else {
          await record(state, {
            type: 'session.failed',
            code: 'auth_required',
            message: notReadyMessage(output),
          })
        }
      } finally {
        state.gate.close()
        sessions.delete(identity(key))
      }
    })()

    state.logger.info({ resumed: resume !== undefined }, 'session started')
    return state
  }

  function sessionFor(key: SessionKey): SessionState {
    const state = sessions.get(identity(key))
    if (state === undefined) throw new Error(`No session for ${identity(key)}.`)
    return state
  }

  return {
    async attach(key) {
      const id = identity(key)
      if (sessions.has(id)) return

      const inFlight = starting.get(id)
      if (inFlight !== undefined) {
        await inFlight
        return
      }

      const attempt = start(key).finally(() => starting.delete(id))
      starting.set(id, attempt)
      await attempt
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
