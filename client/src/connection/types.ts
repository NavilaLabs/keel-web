import type {
  AssistantDelta,
  ClientCommand,
  ServerEvent,
  SessionControlsMessage,
  SessionKey,
} from '@keel-web/protocol'

export type FatalReason = 'auth_required' | 'startup_failed'

export interface StreamHandlers {
  /** A recorded event. Called again with the same event after a reconnect only if the browser lost it. */
  onEvent: (event: ServerEvent) => void
  /** Token-level text. Safe to ignore entirely. */
  onDelta: (delta: AssistantDelta) => void
  /**
   * What the session runs with, in full.
   *
   * Called once soon after the stream opens and again on every change. Each
   * call replaces what the one before it said. Safe to ignore entirely.
   */
  onControls: (message: SessionControlsMessage) => void
  /**
   * The stream will not come back.
   *
   * Called at most once per open, after the stream has been closed. The
   * browser retries a dropped connection by itself, so this means the server
   * said something that retrying cannot fix.
   */
  onFatal: (reason: FatalReason) => void
}

/** Closes the stream. Safe to call twice, and safe to call after `onFatal`. */
export type CloseStream = () => void

/**
 * What became of a command the browser sent.
 *
 * `not_held` covers both a permission request someone else answered first and
 * a settings change the session cannot run with, because both mean the same
 * thing to a caller: the command was understood and the session would not
 * take it.
 */
export type SendResult = 'accepted' | 'malformed' | 'no_session' | 'not_held'

/** Why a stream ended for good rather than being retried. */

export interface Connection {
  /**
   * Opens the event stream for a session and replays everything after `afterSeq`.
   *
   * Pass 0 to replay the whole transcript. Reconnection is the browser's job;
   * the caller sees a continuous series of events across it. A session failure
   * that retrying cannot fix closes the stream and reports `onFatal`, so the
   * caller never has to guard against a reconnect loop.
   */
  open: (key: SessionKey, afterSeq: number, handlers: StreamHandlers) => CloseStream

  /**
   * Sends one command.
   *
   * Never throws and never rejects: a transport failure is reported as
   * `no_session`, because the browser cannot tell it apart from a session that
   * ended. `not_held` means someone else answered that permission request
   * first, which is an outcome, not an error.
   */
  send: (key: SessionKey, command: ClientCommand) => Promise<SendResult>
}

export type CreateConnection = (baseUrl: string) => Connection
