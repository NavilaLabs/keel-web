import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionDecision, RequestId, SessionKey, StreamMessage } from '@keel-web/protocol'
import type { Logger } from '../logging/types.js'
import type { TranscriptLog } from '../transcript/types.js'
import type { WorkspaceRegistry } from '../workspaces/types.js'

export type Unsubscribe = () => void

/**
 * Owns every session and outlives any request.
 *
 * The agent runs with the code repository as its working directory and every
 * tool call passes the permission gate, so nothing runs unapproved. A session
 * is never bound to the request that created it: closing a browser tab leaves
 * it running.
 *
 * The agent is a child of this process and therefore runs as whoever started
 * the server, on the same machine and the same filesystem. That is what lets
 * it reach the developer's own repositories and their own Claude Code login.
 */
export interface SessionRegistry {
  /**
   * Makes sure a session exists for that key, starting or resuming it if
   * needed.
   *
   * The agent runs in the workspace's repository. Idempotent: concurrent calls
   * for one key start only one agent, and a call for a session that is already
   * running does nothing.
   *
   * Returns once the session will accept messages, which is all the caller
   * needs and all this can honestly promise. It deliberately does not wait for
   * the agent to announce itself: the Agent SDK sends its `init` message when
   * the first turn begins, and the first turn begins when a message arrives
   * through `send`, so waiting here would wait for something only the caller
   * can cause.
   *
   * Rejects only with `UnknownWorkspaceError`, for a workspace that is not
   * registered or cannot hold a session. Everything else the agent does wrong,
   * including a missing login, surfaces as a `session.failed` event on the
   * stream, because it cannot be known before the agent has had something to
   * do.
   */
  attach(key: SessionKey): Promise<void>

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

  /**
   * Claude Code's configuration directory, holding whatever the developer
   * logged in with.
   *
   * Handed to the agent as part of its environment, so both sides resolve the
   * same directory instead of each reading `CLAUDE_CONFIG_DIR` for itself.
   * The registry never reads it: what counts as a login is the agent's
   * answer, not a file this process can inspect.
   */
  configDirectory: string

  transcript: TranscriptLog
  logger: Logger

  /** The agent runner. Injected so the registry can be driven without a real agent. */
  runQuery?: RunQuery
}
