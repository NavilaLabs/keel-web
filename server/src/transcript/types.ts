import type { Sequence, ServerEvent, ServerEventBody, SessionKey } from '@keel-web/protocol'
import type { WorkspaceRegistry } from '../workspaces/types.js'

/**
 * The session's record, and the only source a replay is built from.
 *
 * Lives in the workspace's ticket repository beside knowledge.md and
 * state.json, so it travels with the repository and keel-web keeps no store
 * of its own. Survives a process restart. Live and replayed events are the
 * same objects, so a viewer cannot tell which it received.
 */
export interface TranscriptLog {
  /**
   * Assigns the next sequence number and persists the event before returning.
   *
   * Not idempotent: appending the same body twice yields two events. Callers
   * must serialise their appends per session; concurrent appends to one
   * session are not ordered.
   */
  append(key: SessionKey, body: ServerEventBody): Promise<ServerEvent>

  /**
   * Every event after `afterSeq`, oldest first, with no gaps.
   *
   * Returns empty for an unknown session rather than throwing. Pass 0 for the
   * whole transcript.
   */
  since(key: SessionKey, afterSeq: Sequence): Promise<ServerEvent[]>

  /** 0 for a session that has no events yet. */
  lastSequence(key: SessionKey): Promise<Sequence>

  /**
   * The agent session id this ticket last ran under, for resuming it.
   *
   * Read from the transcript's own `session.started` events rather than kept
   * separately, so there is one record and not two that can disagree.
   * Undefined when the ticket has never run.
   */
  lastSessionId(key: SessionKey): Promise<string | undefined>
}

/**
 * Rejects when the workspace has no ticket repository, because then there is
 * nowhere to keep the record and keel-web will not invent one.
 */
export type CreateTranscriptLog = (workspaces: WorkspaceRegistry) => TranscriptLog
