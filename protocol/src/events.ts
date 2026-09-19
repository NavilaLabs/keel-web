/**
 * The wire contract between the web client and the web server.
 *
 * Server events travel on the SSE stream, client commands on the input
 * endpoint. Both sides depend on this module and nothing else.
 */

/** Monotonic per ticket, starting at 1. Gaps mean events were lost, never reordered. */
export type Sequence = number

export type TicketId = string

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
}

/**
 * A tool call held at the gate.
 *
 * `questions` is present exactly when `toolName` is `AskUserQuestion`; the
 * answer must then use the `answers` decision rather than allow or deny.
 */
export interface PermissionRequest {
  requestId: RequestId
  toolName: string
  input: Record<string, unknown>
  questions?: Question[]
}

/**
 * How the developer answered a held tool call.
 *
 * `deny` carries a message Claude Code reads and may act on, so an empty
 * message is a worse answer than a reason.
 */
export type PermissionDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; message: string }
  | { decision: 'answers'; answers: Record<string, string[]> }

/**
 * An event that is part of the session's record.
 *
 * Every event carries a sequence number, is appended to the transcript, and
 * is replayed unchanged to a viewer that reconnects. Rendering the same
 * sequence twice must produce the same result.
 */
export type ServerEvent = {
  seq: Sequence
  ticketId: TicketId
} & ServerEventBody

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
 * `auth_required` means the container has no Claude Code login and the
 * developer must run `claude` in it once. It is the only failure the UI can
 * act on by itself.
 */
export type SessionFailureCode = 'auth_required' | 'startup_failed' | 'agent_error'

/**
 * Token-level output, sent live and never recorded.
 *
 * Carries no sequence number and is absent from a replay: a viewer that
 * reconnects sees the finished `assistant.message` instead. A client that
 * ignores deltas entirely still renders a correct transcript.
 */
export interface AssistantDelta {
  type: 'assistant.delta'
  ticketId: TicketId
  text: string
}

/** Everything the stream sends. */
export type StreamMessage = ServerEvent | AssistantDelta

/**
 * What the browser sends to the input endpoint.
 *
 * `interrupt` stops the current turn and leaves the session usable.
 */
export type ClientCommand =
  | { command: 'message'; text: string }
  | { command: 'permission'; requestId: RequestId; decision: PermissionDecision }
  | { command: 'interrupt' }
