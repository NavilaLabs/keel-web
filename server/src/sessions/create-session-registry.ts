import { randomUUID } from 'node:crypto'
import {
  query,
  type ModelInfo,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type SDKUserMessage,
  type SlashCommand,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  ModelChoice,
  PermissionDecision,
  PermissionRequest,
  Question,
  SessionControls,
  SessionKey,
  SessionMode,
  SessionSettings,
  SessionSettingsChange,
  SlashCommandSummary,
  StreamMessage,
} from '@keel-web/protocol'
import type { Logger } from '../logging/types.js'
import { createPermissionGate } from '../permissions/index.js'
import type { PermissionGate } from '../permissions/types.js'
import type { TranscriptLog } from '../transcript/types.js'
import { deltaTextOf, normalise } from './normalise.js'
import {
  UnknownWorkspaceError,
  UnusableSettingsError,
  type RunQuery,
  type SessionRegistry,
  type SessionRegistryOptions,
  type SessionRun,
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
  run: SessionRun
  settings: SessionSettings
  models: readonly ModelChoice[]
  commands: readonly SlashCommandSummary[]
  /** Resolves once the agent has answered with its commands and models. */
  catalogue: Promise<void>
  /**
   * Tools a session rule now covers.
   *
   * Only the tool name, because what the rule actually matches is the agent's
   * to decide: this says no more than that the hook should stop forcing the
   * ask for it and let that rule be reached.
   */
  ruled: Set<string>
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

const offeredModes: readonly SessionMode[] = ['default', 'auto', 'acceptEdits', 'dontAsk', 'plan']

function modelChoiceOf(info: ModelInfo): ModelChoice {
  return {
    value: info.value,
    displayName: info.displayName,
    description: info.description,
    effortLevels: info.supportsEffort === true ? (info.supportedEffortLevels ?? []) : [],
  }
}

function commandSummaryOf(command: SlashCommand): SlashCommandSummary {
  return {
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
    ...(command.aliases !== undefined && { aliases: command.aliases }),
    ...(command.builtin !== undefined && { builtin: command.builtin }),
  }
}

/**
 * The suggestions, rewritten so none of them outlives the session.
 *
 * The agent proposes where a rule should be written, and some of those places
 * are the developer's own settings files. Nothing here is allowed to leave a
 * trace on disk, so every destination becomes `session` rather than being
 * taken as offered.
 */
function sessionScoped(suggestions: readonly PermissionUpdate[]): PermissionUpdate[] {
  return suggestions.map((suggestion) => ({ ...suggestion, destination: 'session' as const }))
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
    state: SessionState,
    decision: PermissionDecision,
    input: Record<string, unknown>,
    suggestions: readonly PermissionUpdate[],
  ): PermissionResult {
    if (decision.decision === 'deny') return { behavior: 'deny', message: decision.message }
    if (decision.decision === 'answers') {
      return { behavior: 'allow', updatedInput: { ...input, answers: decision.answers } }
    }
    if (decision.alwaysAllow !== true || suggestions.length === 0) return { behavior: 'allow' }

    const updatedPermissions = sessionScoped(suggestions)
    for (const update of updatedPermissions) {
      if (update.type !== 'addRules') continue
      for (const rule of update.rules) state.ruled.add(rule.toolName)
    }
    return { behavior: 'allow', updatedPermissions, decisionClassification: 'user_permanent' }
  }

  /**
   * Takes over what the agent says it is running with.
   *
   * The agent can change both by itself, leaving plan mode being the usual
   * case, and it is the one that knows. A mode keel-web does not offer is
   * ignored rather than shown, because nothing here can be switched back to
   * it.
   */
  function adoptAgentSettings(state: SessionState, model: unknown, mode: unknown): void {
    const known = offeredModes.find((offered) => offered === mode)
    if (known !== undefined) state.settings.mode = known
    if (typeof model === 'string' && model.length > 0) state.settings.model = model
    announceControls(state)
  }

  /** The model a change would leave the session on, as far as it is known. */
  function chosenModel(
    state: SessionState,
    change: SessionSettingsChange,
  ): ModelChoice | undefined {
    const value = change.model === undefined ? state.settings.model : (change.model ?? undefined)
    return value === undefined ? undefined : state.models.find((model) => model.value === value)
  }

  function controlsOf(state: SessionState): SessionControls {
    return { settings: { ...state.settings }, models: state.models, commands: state.commands }
  }

  function announceControls(state: SessionState): void {
    broadcast(state, { type: 'session.controls', ...state.key, controls: controlsOf(state) })
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
      // In its default mode the browser is asked about every tool call, which
      // is stricter than the agent would be on its own. Any other mode is the
      // developer having said in advance what need not be asked, so the hook
      // steps aside and lets the agent resolve the call the way the terminal
      // would. It steps aside for a tool a session rule now covers too, or
      // that rule could never be reached.
      hooks: {
        PreToolUse: [
          {
            hooks: [
              (input) => {
                const mode = input.permission_mode ?? state.settings.mode
                const toolName = (input as { tool_name?: string }).tool_name ?? ''
                if (mode !== 'default' || state.ruled.has(toolName)) return Promise.resolve({})
                return Promise.resolve({
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'ask' as const,
                    permissionDecisionReason: 'keel-web asks the developer in the browser',
                  },
                })
              },
            ],
          },
        ],
      },
      canUseTool: async (toolName, input, options) => {
        const { signal, defaultToNo, suppressAlwaysAllowRule } = options
        const suggestions = options.suggestions ?? []
        const alwaysAllowable = suppressAlwaysAllowRule !== true && suggestions.length > 0
        const request: PermissionRequest = {
          requestId: randomUUID(),
          toolName,
          input,
          ...(questionsOf(toolName, input) !== undefined && {
            questions: questionsOf(toolName, input),
          }),
          ...(alwaysAllowable && { alwaysAllowable: true }),
          ...(defaultToNo === true && { defaultToNo: true }),
        }
        await record(state, { type: 'permission.requested', request })
        const decision = await state.gate.hold(request, signal)
        await record(state, {
          type: 'permission.resolved',
          requestId: request.requestId,
          decision,
        })
        return permissionResultOf(state, decision, input, alwaysAllowable ? suggestions : [])
      },
    }
  }

  /**
   * Asks the agent what it offers.
   *
   * Never rejects: an agent that cannot answer, which is what no login looks
   * like from here, leaves the lists empty rather than making the session
   * unusable. The failure the developer needs to see is the one the run
   * itself reports.
   */
  async function loadCatalogue(state: SessionState): Promise<void> {
    try {
      const [commands, models] = await Promise.all([
        state.run.supportedCommands(),
        state.run.supportedModels(),
      ])
      state.commands = commands.map(commandSummaryOf)
      state.models = models.map(modelChoiceOf)
      announceControls(state)
    } catch (error) {
      state.logger.warn({ err: String(error) }, 'the agent did not say what it offers')
    }
  }

  async function start(key: SessionKey): Promise<SessionState> {
    const repository = repositoryOf(key)

    // The run needs options that read this state, and the state needs the run
    // the options produce, so the two are tied together in that order rather
    // than in one expression.
    const state = {
      key,
      sessionId: '',
      gate: createPermissionGate(),
      listeners: new Set(),
      input: createInputQueue(),
      abort: new AbortController(),
      logger: logger.child({ ...key }),
      settings: { mode: 'default' },
      models: [],
      commands: [],
      ruled: new Set<string>(),
    } as unknown as SessionState

    const resume = await transcript.lastSessionId(key)
    const run = runQuery({
      prompt: state.input.stream,
      options: optionsFor(state, repository, resume),
    })
    state.run = run
    state.catalogue = loadCatalogue(state)

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
          if (message.type === 'system' && message.subtype === 'commands_changed') {
            state.commands = message.commands.map(commandSummaryOf)
            announceControls(state)
            continue
          }
          if (message.type === 'system' && message.subtype === 'init') {
            adoptAgentSettings(state, message.model, message.permissionMode)
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

    async controls(key) {
      const state = sessionFor(key)
      await state.catalogue
      return controlsOf(state)
    },

    async changeControls(key, change) {
      const state = sessionFor(key)
      await state.catalogue
      const chosen = chosenModel(state, change)

      if (change.model !== undefined && change.model !== null && chosen === undefined) {
        throw new UnusableSettingsError(`This session cannot run on ${change.model}.`)
      }
      if (
        change.effort !== undefined &&
        change.effort !== null &&
        chosen !== undefined &&
        !chosen.effortLevels.includes(change.effort)
      ) {
        throw new UnusableSettingsError(
          `${chosen.displayName} has no ${change.effort} effort to run at.`,
        )
      }

      if (change.mode !== undefined) {
        await state.run.setPermissionMode(change.mode)
        state.settings.mode = change.mode
      }
      if (change.model !== undefined) {
        await state.run.setModel(change.model ?? undefined)
        if (change.model === null) delete state.settings.model
        else state.settings.model = change.model
      }
      if (change.effort !== undefined) {
        await state.run.applyFlagSettings({ effortLevel: change.effort })
        if (change.effort === null) delete state.settings.effort
        else state.settings.effort = change.effort
      }

      announceControls(state)
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
