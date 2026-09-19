import type {
  PermissionDecision,
  PermissionRequest,
  RequestId,
  SessionKey,
  StreamMessage,
} from '@keel-web/protocol'

/** A running Claude Code session. One per workspace and ticket, never two. */
export interface Session {
  readonly key: SessionKey

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
   * Returns the session, starting or resuming it if needed.
   *
   * The agent runs in the workspace's repository. Idempotent: concurrent calls
   * for one key yield the same session and start only one agent. Rejects with
   * `UnknownWorkspaceError` for a workspace that is not registered, with
   * `AuthRequiredError` when Claude Code has no login, and with
   * `SessionStartError` when the agent does not become ready in time.
   */
  attach(key: SessionKey): Promise<Session>

  /**
   * Queues a message for the session's current or next turn.
   *
   * Rejects for a key that has no session; `attach` first.
   */
  send(key: SessionKey, text: string): Promise<void>

  /**
   * Answers a held tool call.
   *
   * False when the request is unknown or was already answered. Answering
   * twice is safe.
   */
  answerPermission(
    key: SessionKey,
    requestId: RequestId,
    decision: PermissionDecision,
  ): Promise<boolean>

  /**
   * Stops the current turn and leaves the session usable.
   *
   * Does nothing when no turn is running.
   */
  interrupt(key: SessionKey): Promise<void>

  /**
   * Live messages from now on, recorded events and deltas alike.
   *
   * Delivers nothing that happened earlier: a viewer replays the transcript
   * first, then subscribes. The listener must not throw. Unsubscribing twice
   * is safe.
   */
  subscribe(key: SessionKey, listener: (message: StreamMessage) => void): Unsubscribe

  /**
   * Ends the session and denies everything still held at the gate.
   *
   * Idempotent. The transcript is kept, so the session can be attached again.
   */
  close(key: SessionKey): Promise<void>
}

/** No workspace is registered under that id. */
export class UnknownWorkspaceError extends Error {
  override readonly name = 'UnknownWorkspaceError'
}

/** Claude Code has no login; `claude` must be run once where the agent runs. */
export class AuthRequiredError extends Error {
  override readonly name = 'AuthRequiredError'
}

/** The agent subprocess did not become ready. */
export class SessionStartError extends Error {
  override readonly name = 'SessionStartError'
}
