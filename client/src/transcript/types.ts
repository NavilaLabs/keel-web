import type {
  PermissionDecision,
  PermissionRequest,
  ServerEvent,
  SessionKey,
} from '@keel-web/protocol'

/**
 * One thing the chat draws.
 *
 * Tool calls and permission requests are folded from their two events, so a
 * call whose result has not arrived is still one item, marked unfinished.
 */
export type RenderItem =
  | { kind: 'message'; key: string; author: 'developer' | 'agent'; text: string }
  | { kind: 'thinking'; key: string; text: string }
  | {
      kind: 'tool'
      key: string
      name: string
      input: Record<string, unknown>
      result?: { ok: boolean; summary: string }
    }
  | { kind: 'permission'; key: string; request: PermissionRequest; decision?: PermissionDecision }
  | { kind: 'failure'; key: string; text: string; authRequired: boolean }
  | { kind: 'idle'; key: string; turns: number; costUsd: number }

/**
 * Folds recorded events into what the chat draws.
 *
 * Pure and total: unknown or unpaired events never throw. Folding the same
 * events twice gives the same items, which is what makes a replay and a live
 * stream indistinguishable. `key` is stable across folds of a growing list, so
 * it can be used as a React key.
 */
export type Fold = (events: readonly ServerEvent[]) => RenderItem[]

export type Unsubscribe = () => void

/**
 * Holds one session's transcript and its live draft.
 *
 * The connection belongs to the store rather than to a component, so mounting
 * and unmounting never opens or closes a stream.
 */
export interface TranscriptStore {
  /**
   * Opens the session's stream, replaying from what is already held.
   *
   * Idempotent for the session already connected. Connecting to another
   * session, in this workspace or another, closes the previous stream first.
   */
  connect: (key: SessionKey) => void

  /** Closes the stream and keeps what was received. Safe without a connection. */
  disconnect: () => void

  /**
   * The folded transcript.
   *
   * Returns the identical reference until something recorded arrives, which is
   * what `useSyncExternalStore` requires. Deltas never change it.
   */
  getTranscript: () => readonly RenderItem[]

  /** The text streamed since the last finished message, empty when none is in flight. */
  getDraft: () => string

  /** Recorded events only. The listener must not throw. */
  subscribeTranscript: (listener: () => void) => Unsubscribe

  /** Draft changes only, so a token redraws one bubble rather than the list. */
  subscribeDraft: (listener: () => void) => Unsubscribe

  /** Queues a message for the agent and shows it once the server records it. */
  send: (text: string) => Promise<void>

  /**
   * Answers a held tool call.
   *
   * The prompt stays on screen until `permission.resolved` arrives, so a call
   * answered in another tab disappears here too, and a rejected answer leaves
   * the prompt usable.
   */
  answer: (requestId: string, decision: PermissionDecision) => Promise<void>

  /** Stops the current turn. Does nothing when none is running. */
  interrupt: () => Promise<void>
}
