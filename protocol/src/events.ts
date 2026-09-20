/**
 * The wire contract between the web client and the web server.
 *
 * Server events travel on the SSE stream, client commands on the input
 * endpoint. Both sides depend on this module and nothing else.
 */

import type { SessionControls, SessionSettingsChange } from './session-controls.js'

/** Monotonic per ticket, starting at 1. Gaps mean events were lost, never reordered. */
export type Sequence = number

export type TicketId = string

/**
 * A repository keel-web works in.
 *
 * Stable across restarts, since it keys sessions, transcripts and URLs. It is
 * not a path: a workspace can move on disk without becoming a different
 * workspace.
 */
export type WorkspaceId = string

/**
 * What a session belongs to.
 *
 * Ticket 3 in one repository is not ticket 3 in another, so neither half
 * identifies a session on its own.
 */
export interface SessionKey {
  workspaceId: WorkspaceId
  ticketId: TicketId
}

/**
 * Where a repository's tickets live, as `.claude/keel.json` names it.
 *
 * `repository` is the tracker's own identifier, so `owner/name` for GitHub and
 * a project key for Jira. The token is never on the wire: only the name of the
 * environment variable holding it is configuration, and that stays on the
 * server.
 */
export interface WorkspaceTracker {
  source: 'github' | 'jira'
  repository: string
}

/**
 * A repository the developer has added, as the sidebar sees it.
 *
 * `state` is the whole story, so the three cases are exhaustive and none of
 * them overlaps. They are ordered by what can be known: an unreachable path
 * says nothing about the keel configuration inside it, so `unreachable` wins
 * over `unconfigured` rather than both being reported.
 *
 * Only `ready` carries `ticketRepository`, because that is exactly the
 * condition under which a session, a transcript and a ticket view are
 * possible. A workspace in either other state is listed, is selectable, and
 * explains itself through `reason`, which is one sentence written for the
 * developer rather than an error code.
 */
export type WorkspaceSummary = {
  id: WorkspaceId
  /** What the developer calls it, defaulting to the directory name. */
  name: string
  /** Absolute path, as it is on the machine keel-web runs on. */
  path: string
} & (
  | {
      state: 'ready'
      /** Absolute path of the ticket repository `.claude/keel.json` names. */
      ticketRepository: string
      tracker?: WorkspaceTracker
    }
  | { state: 'unreachable'; reason: string }
  | { state: 'unconfigured'; reason: string }
)

/** One subdirectory, as the picker shows it. */
export interface DirectoryEntry {
  /** The directory name on its own, which is what the list shows. */
  name: string
  /** The absolute path, so choosing an entry needs no path arithmetic in the browser. */
  path: string
}

/**
 * One directory of the machine keel-web runs on, for picking a repository.
 *
 * A browser cannot hand over a filesystem path: a directory picker yields a
 * handle, and a directory input yields names relative to the chosen folder.
 * Since the server runs on the same machine as the developer, it is the one
 * that can walk the filesystem, and this is what it says back.
 *
 * Entries are subdirectories only, sorted by name without regard to case, and
 * leave out anything starting with a dot. Files are absent because a workspace
 * is always a directory.
 */
export interface DirectoryListing {
  /** The directory that was listed, absolute and resolved. */
  path: string
  /** The directory above, absent only at the root of the filesystem. */
  parent?: string
  entries: readonly DirectoryEntry[]
}

export type RequestId = string

export type ToolUseId = string

/**
 * A question Claude Code asks through the AskUserQuestion tool.
 *
 * Carried verbatim so the browser can render the same choices the terminal
 * would show. `header` is at most 12 characters.
 */
export interface Question {
  question: string
  header: string
  multiSelect: boolean
  options: QuestionOption[]
}

export interface QuestionOption {
  label: string
  description: string
  /** Mockup, snippet or comparison to show while this option is focused. */
  preview?: string
}

/**
 * A tool call held at the gate.
 *
 * `questions` is present exactly when `toolName` is `AskUserQuestion`; the
 * answer must then use the `answers` decision rather than allow or deny.
 *
 * `alwaysAllowable` and `defaultToNo` are absent on a request recorded before
 * they existed, and a reader that replays an old transcript must read an
 * absent field as `false`.
 */
export interface PermissionRequest {
  requestId: RequestId
  toolName: string
  input: Record<string, unknown>
  questions?: Question[]
  /**
   * Whether this call may be allowed for the rest of the session.
   *
   * False when a rule covering it would grant more than the call itself, in
   * which case offering it anyway would widen the permission the developer
   * thinks they are giving.
   */
  alwaysAllowable?: boolean
  /**
   * Whether the answer must not be reachable by a single stray keystroke.
   *
   * True for a call the agent flagged as one to decline by default, so the
   * prompt opens on its refusal and offers no shortcut to approval.
   */
  defaultToNo?: boolean
}

/**
 * How the developer answered a held tool call.
 *
 * `deny` carries a message Claude Code reads and may act on, so an empty
 * message is a worse answer than a reason.
 *
 * `answers` is keyed by the full question text, not by its header. A
 * multi-select answer lists the chosen labels separated by a comma, and free
 * text the developer typed instead of choosing arrives as the value. This is
 * the shape the agent expects; anything else is read as no answer at all.
 *
 * `alwaysAllow` allows this call and every later one the agent would ask the
 * same question for, until the session ends. It is refused for a request whose
 * `alwaysAllowable` is not true, and nothing it grants outlives the session:
 * no rule is written to the developer's settings.
 */
export type PermissionDecision =
  | { decision: 'allow'; alwaysAllow?: boolean }
  | { decision: 'deny'; message: string }
  | { decision: 'answers'; answers: Record<string, string> }

/**
 * An event that is part of the session's record.
 *
 * Every event carries a sequence number, is appended to the transcript, and
 * is replayed unchanged to a viewer that reconnects. Rendering the same
 * sequence twice must produce the same result.
 */
export type ServerEvent = {
  seq: Sequence
} & SessionKey &
  ServerEventBody

export type ServerEventBody =
  | { type: 'session.started'; sessionId: string; resumed: boolean }
  | { type: 'user.message'; text: string }
  | { type: 'assistant.message'; text: string }
  | { type: 'assistant.thinking'; text: string }
  | { type: 'tool.started'; toolUseId: ToolUseId; name: string; input: Record<string, unknown> }
  | { type: 'tool.completed'; toolUseId: ToolUseId; ok: boolean; summary: string }
  | { type: 'permission.requested'; request: PermissionRequest }
  | { type: 'permission.resolved'; requestId: RequestId; decision: PermissionDecision }
  | { type: 'session.idle'; turns: number; costUsd: number }
  | { type: 'session.failed'; code: SessionFailureCode; message: string }

/**
 * `auth_required` means the agent gave up before it was ready, which is what
 * a missing or expired login looks like from here. A login is never probed
 * for, so an agent that failed to start for an unrelated reason arrives under
 * the same code, with its own output in `message`. It is the only failure the
 * UI can act on by itself: run `claude` once as the user that started the
 * server.
 */
export type SessionFailureCode = 'auth_required' | 'startup_failed' | 'agent_error'

/**
 * Token-level output, sent live and never recorded.
 *
 * Carries no sequence number and is absent from a replay: a viewer that
 * reconnects sees the finished `assistant.message` instead. A client that
 * ignores deltas entirely still renders a correct transcript.
 */
export interface AssistantDelta extends SessionKey {
  type: 'assistant.delta'
  text: string
}

/**
 * What the session runs with, sent live and never recorded.
 *
 * Carries no sequence number and is absent from a replay. It is sent once
 * when a viewer attaches and again whenever any of it changes, and each one
 * replaces the one before it: a client that has seen only the latest is
 * fully up to date. A client that ignores it entirely still renders a correct
 * transcript.
 */
export interface SessionControlsMessage extends SessionKey {
  type: 'session.controls'
  controls: SessionControls
}

/** Everything the stream sends. */
export type StreamMessage = ServerEvent | AssistantDelta | SessionControlsMessage

/**
 * What the browser sends to the input endpoint.
 *
 * `interrupt` stops the current turn and leaves the session usable.
 *
 * `settings` changes what the session runs with. It takes effect from the
 * next turn on and never interrupts a running one, and the change is
 * confirmed by the next `session.controls` message rather than by the
 * response.
 */
export type ClientCommand =
  | { command: 'message'; text: string }
  | { command: 'permission'; requestId: RequestId; decision: PermissionDecision }
  | { command: 'interrupt' }
  | { command: 'settings'; change: SessionSettingsChange }
