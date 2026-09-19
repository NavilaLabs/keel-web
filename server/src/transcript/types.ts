import type { Sequence, ServerEvent, ServerEventBody, TicketId } from '@keel-web/protocol'

/**
 * The session's record, and the only source a replay is built from.
 *
 * Survives a process restart. Live and replayed events are the same objects,
 * so a viewer cannot tell which it received.
 */
export interface TranscriptLog {
  /**
   * Assigns the next sequence number and persists the event before returning.
   *
   * Not idempotent: appending the same body twice yields two events. Callers
   * must serialise their appends per ticket; concurrent appends to one ticket
   * are not ordered.
   */
  append(ticketId: TicketId, body: ServerEventBody): Promise<ServerEvent>

  /**
   * Every event after `afterSeq`, oldest first, with no gaps.
   *
   * Returns empty for an unknown ticket rather than throwing. Pass 0 for the
   * whole transcript.
   */
  since(ticketId: TicketId, afterSeq: Sequence): Promise<ServerEvent[]>

  /** 0 for a ticket that has no events yet. */
  lastSequence(ticketId: TicketId): Promise<Sequence>
}

export type CreateTranscriptLog = (directory: string) => TranscriptLog
