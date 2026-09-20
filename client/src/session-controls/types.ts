import type {
  SessionControls,
  SessionControlsMessage,
  SessionKey,
  SessionSettingsChange,
} from '@keel-web/protocol'

export type Unsubscribe = () => void

/** What became of a change the developer asked for. */
export type ChangeResult = 'accepted' | 'refused' | 'no_session'

/**
 * Holds what one session runs with and what it could run with instead.
 *
 * The session's stream is opened once, by the transcript store, so this is
 * told what arrives rather than listening for itself. Nothing here is asked
 * for from the server: a store that has been told nothing yet simply has
 * nothing, which is the state between opening a ticket and the stream
 * answering.
 */
export interface SessionControlsStore {
  /**
   * What the session runs with, or undefined until the stream has said.
   *
   * Returns the identical reference until something changes, which is what
   * `useSyncExternalStore` requires.
   */
  getControls: () => SessionControls | undefined

  /** The listener must not throw. */
  subscribe: (listener: () => void) => Unsubscribe

  /**
   * Takes what the stream said.
   *
   * Replaces everything held, because each message carries the whole state.
   * A message for another session than the one pointed at is ignored rather
   * than mixed in.
   */
  take: (message: SessionControlsMessage) => void

  /**
   * Points the store at a session, discarding what the previous one said.
   *
   * Idempotent for the session already pointed at.
   */
  pointAt: (key: SessionKey) => void

  /**
   * Asks the session to run with something else.
   *
   * Never throws. What is held changes only once the server has confirmed it
   * on the stream, so a refused change leaves the developer looking at what
   * the session is really running with rather than at what they asked for.
   *
   * `refused` means the session will not run with it, which is an outcome,
   * not an error.
   */
  change: (change: SessionSettingsChange) => Promise<ChangeResult>
}
