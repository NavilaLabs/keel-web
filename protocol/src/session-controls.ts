/**
 * What a session runs with, and what it could run with instead.
 *
 * These travel on the same stream as the events but are never recorded: they
 * are the session's current state, not part of its history, and a viewer that
 * reconnects is told them again rather than replaying every change.
 */

/**
 * The permission modes keel-web offers.
 *
 * Narrower than the agent's own set on purpose. `bypassPermissions` would run
 * every tool unasked, so it cannot be named on the wire and is not accepted
 * from a client.
 *
 * `default` is the only mode in which every tool call reaches the browser.
 * `auto` lets a classifier answer the ones it is sure about and asks about
 * the rest, `acceptEdits` runs file edits unasked, `dontAsk` denies whatever
 * is not already allowed instead of asking, and `plan` lets the agent plan
 * without running anything.
 */
export type SessionMode = 'default' | 'auto' | 'acceptEdits' | 'plan' | 'dontAsk'

/** How much thinking a model is asked for, where the model supports it. */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * One command the session offers for a slash completion.
 *
 * `name` carries no leading slash. `argumentHint` is present but empty for a
 * command that takes no arguments, so it is a hint to show, never a promise
 * that arguments exist.
 *
 * Two commands may share a `name`. `builtin` then decides which one `/name`
 * runs: the marked one wins, and an unmarked one runs only when no marked one
 * shares its name.
 */
export interface SlashCommandSummary {
  name: string
  description: string
  argumentHint: string
  aliases?: readonly string[]
  builtin?: boolean
}

/**
 * One model the session can be switched to.
 *
 * `value` is what a change names, and it may be an alias such as `sonnet`.
 * `effortLevels` is empty for a model that has no effort control, which is
 * exactly when an effort change is refused for it.
 */
export interface ModelChoice {
  value: string
  displayName: string
  description: string
  effortLevels: readonly EffortLevel[]
}

/**
 * What the session is running with right now.
 *
 * `model` and `effort` are absent while the session runs on whatever the
 * agent chose for itself, which is the state a session starts in. `mode` is
 * always known, because a session always runs in one.
 */
export interface SessionSettings {
  model?: string
  mode: SessionMode
  effort?: EffortLevel
}

/**
 * A change the developer asks for.
 *
 * Every field is three-valued and they are not interchangeable: absent leaves
 * that setting alone, `null` returns it to the agent's own default, and a
 * value sets it. A change naming nothing is accepted and does nothing.
 *
 * An effort change for a model without effort control is refused rather than
 * silently dropped, so the browser never shows a level the agent is not using.
 */
export interface SessionSettingsChange {
  model?: string | null
  mode?: SessionMode
  effort?: EffortLevel | null
}

/**
 * Everything the browser needs to show and change what a session runs with.
 *
 * `models` and `commands` are complete lists, never deltas: a later one
 * replaces the one before it entirely.
 */
export interface SessionControls {
  settings: SessionSettings
  models: readonly ModelChoice[]
  commands: readonly SlashCommandSummary[]
}
