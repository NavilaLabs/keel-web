import type {
  PermissionDecision,
  PermissionRequest,
  RequestId,
  StreamMessage,
  TicketId,
} from '@keel-web/protocol'

/** A running Claude Code session. One per ticket, never two. */
export interface Session {
  readonly ticketId: TicketId

  /** The Agent SDK session id, used to resume this ticket after a restart. */
  readonly sessionId: string

  /** Tool calls waiting for an answer, oldest first. */
  pendingPermissions(): readonly PermissionRequest[]
}

export type Unsubscribe = () => void

/**
 * Owns every session and outlives any request.
 *
 * The agent runs with the code repository as its working directory and every
 * tool call passes the permission gate, so nothing runs unapproved. A session
 * is never bound to the request that created it: closing a browser tab leaves
 * it running.
 */
export interface SessionRegistry {
  /**
   * Returns the ticket's session, starting or resuming it if needed.
   *
   * Idempotent: concurrent calls for one ticket yield the same session and
   * start only one agent. Rejects with `AuthRequiredError` when the container
   * has no Claude Code login, and with `SessionStartError` when the agent does
   * not become ready in time.
   */
  attach(ticketId: TicketId): Promise<Session>

  /**
   * Queues a message for the session's current or next turn.
   *
   * Rejects for a ticket that has no session; `attach` first.
   */
  send(ticketId: TicketId, text: string): Promise<void>

  /**
   * Answers a held tool call.
   *
   * False when the request is unknown or was already answered. Answering
   * twice is safe.
   */
  answerPermission(
    ticketId: TicketId,
    requestId: RequestId,
    decision: PermissionDecision,
  ): Promise<boolean>

  /**
   * Stops the current turn and leaves the session usable.
   *
   * Does nothing when no turn is running.
   */
  interrupt(ticketId: TicketId): Promise<void>

  /**
   * Live messages from now on, recorded events and deltas alike.
   *
   * Delivers nothing that happened earlier: a viewer replays the transcript
   * first, then subscribes. The listener must not throw. Unsubscribing twice
   * is safe.
   */
  subscribe(ticketId: TicketId, listener: (message: StreamMessage) => void): Unsubscribe

  /**
   * Ends the session and denies everything still held at the gate.
   *
   * Idempotent. The transcript is kept, so the ticket can be attached again.
   */
  close(ticketId: TicketId): Promise<void>
}

/** The container has no Claude Code login; `claude` must be run in it once. */
export declare class AuthRequiredError extends Error {}

/** The agent subprocess did not become ready. */
export declare class SessionStartError extends Error {}
