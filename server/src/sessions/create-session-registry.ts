import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { query, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  PermissionDecision,
  PermissionRequest,
  Question,
  StreamMessage,
  TicketId,
} from '@keel-web/protocol'
import type { Logger } from '../logging/types.js'
import { createPermissionGate } from '../permissions/index.js'
import type { PermissionGate } from '../permissions/types.js'
import type { TranscriptLog } from '../transcript/types.js'
import { deltaTextOf, normalise } from './normalise.js'
import {
  AuthRequiredError,
  SessionStartError,
  type Session,
  type SessionRegistry,
  type Unsubscribe,
} from './types.js'

export interface SessionRegistryOptions {
  /** Working directory of the agent: the code repository, as in the terminal. */
  workingDirectory: string
  /** Where the ticket-to-session mapping is kept. */
  stateDirectory: string
  /** Claude Code's configuration directory, holding the container's credentials. */
  configDirectory: string
  transcript: TranscriptLog
  logger: Logger
  /** Milliseconds to wait for the agent to report its session id. */
  startTimeoutMs?: number
}

interface SessionState {
  ticketId: TicketId
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

export function createSessionRegistry(options: SessionRegistryOptions): SessionRegistry {
  const { workingDirectory, stateDirectory, configDirectory, transcript, logger } = options
  const startTimeoutMs = options.startTimeoutMs ?? 60_000

  const sessions = new Map<TicketId, SessionState>()
  const starting = new Map<TicketId, Promise<SessionState>>()
  const sessionIdsFile = join(stateDirectory, 'sessions.json')

  async function readSessionIds(): Promise<Record<TicketId, string>> {
    try {
      return JSON.parse(await readFile(sessionIdsFile, 'utf8')) as Record<TicketId, string>
    } catch {
      return {}
    }
  }

  async function rememberSessionId(ticketId: TicketId, sessionId: string): Promise<void> {
    const known = await readSessionIds()
    known[ticketId] = sessionId
    await mkdir(stateDirectory, { recursive: true })
    await writeFile(sessionIdsFile, `${JSON.stringify(known, null, 2)}\n`, 'utf8')
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
    broadcast(state, await transcript.append(state.ticketId, body))
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

  function optionsFor(state: SessionState, resume: string | undefined): Options {
    return {
      cwd: workingDirectory,
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

  async function start(ticketId: TicketId): Promise<SessionState> {
    await assertLoggedIn()

    const state: SessionState = {
      ticketId,
      sessionId: '',
      gate: createPermissionGate(),
      listeners: new Set(),
      input: createInputQueue(),
      abort: new AbortController(),
      logger: logger.child({ ticketId }),
    }

    const known = await readSessionIds()
    const resume = known[ticketId]
    const run = query({ prompt: state.input.stream, options: optionsFor(state, resume) })

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
            broadcast(state, { type: 'assistant.delta', ticketId, text: delta })
            continue
          }
          for (const body of normalise(message)) {
            if (body.type === 'session.started') {
              const started = { ...body, resumed: resume !== undefined }
              state.sessionId = body.sessionId
              await rememberSessionId(ticketId, body.sessionId)
              await record(state, started)
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
        sessions.delete(ticketId)
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
    sessions.set(ticketId, state)
    state.logger.info(
      { sessionId: state.sessionId, resumed: resume !== undefined },
      'session ready',
    )
    return state
  }

  function toSession(state: SessionState): Session {
    return {
      ticketId: state.ticketId,
      sessionId: state.sessionId,
      pendingPermissions: () => state.gate.pending(),
    }
  }

  function sessionFor(ticketId: TicketId): SessionState {
    const state = sessions.get(ticketId)
    if (state === undefined) throw new Error(`Ticket ${ticketId} has no session.`)
    return state
  }

  return {
    async attach(ticketId) {
      const running = sessions.get(ticketId)
      if (running !== undefined) return toSession(running)

      const inFlight = starting.get(ticketId)
      if (inFlight !== undefined) return toSession(await inFlight)

      const attempt = start(ticketId).finally(() => starting.delete(ticketId))
      starting.set(ticketId, attempt)
      return toSession(await attempt)
    },

    async send(ticketId, text) {
      const state = sessionFor(ticketId)
      await record(state, { type: 'user.message', text })
      state.input.push(text)
    },

    answerPermission(ticketId, requestId, decision) {
      return Promise.resolve(sessionFor(ticketId).gate.answer(requestId, decision))
    },

    async interrupt(ticketId) {
      const state = sessions.get(ticketId)
      if (state === undefined) return
      state.abort.abort()
    },

    subscribe(ticketId, listener): Unsubscribe {
      const state = sessionFor(ticketId)
      state.listeners.add(listener)
      return () => {
        state.listeners.delete(listener)
      }
    },

    async close(ticketId) {
      const state = sessions.get(ticketId)
      if (state === undefined) return
      state.gate.close()
      state.input.close()
      state.abort.abort()
      sessions.delete(ticketId)
      state.logger.info('session closed')
    },
  }
}
