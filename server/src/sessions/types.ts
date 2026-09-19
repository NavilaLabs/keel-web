import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  PermissionDecision,
  PermissionRequest,
  RequestId,
  SessionKey,
  StreamMessage,
} from '@keel-web/protocol'
import type { Logger } from '../logging/types.js'
import type { TranscriptLog } from '../transcript/types.js'
import type { WorkspaceRegistry } from '../workspaces/types.js'

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
 *
 * The agent is a child of this process and therefore runs as whoever started
 * the server, on the same machine and the same filesystem. That is what lets
 * it reach the developer's own repositories and their own Claude Code login.
 */
export interface SessionRegistry {
  /**
   * Returns the session, starting or resuming it if needed.
   *
   * The agent runs in the workspace's repository. Idempotent: concurrent calls
   * for one key yield the same session and start only one agent.
   *
   * Rejects with `UnknownWorkspaceError` for a workspace that is not
   * registered. Rejects with `AuthRequiredError` when the agent exits before
   * it reports itself ready: a login is not probed for, because it can come
   * from a credentials file, the environment, a helper or a cloud provider
   * and only the agent resolves which one applies. Any other failure that
   * early is reported the same way, so the error carries the agent's own
   * output with it. Rejects with `SessionStartError` when the agent starts
   * but does not report its session id in time.
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

/**
 * The agent gave up before it was ready, and a missing or expired login is
 * the likeliest reason.
 *
 * The message carries the agent's own output, because this is also where an
 * agent that failed to start for an unrelated reason lands.
 */
export class AuthRequiredError extends Error {
  override readonly name = 'AuthRequiredError'
}

/** The agent subprocess did not become ready. */
export class SessionStartError extends Error {
  override readonly name = 'SessionStartError'
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

  /** Milliseconds to wait for the agent to report its session id. */
  startTimeoutMs?: number

  /** The agent runner. Injected so the registry can be driven without a real agent. */
  runQuery?: RunQuery
}
