import type { Hono } from 'hono'
import type { LoggerVariables } from '../logging/types.ts'

/**
 * The browser-facing surface of a session, mounted by the HTTP app.
 *
 * Two routes, both under the ticket:
 *
 * `GET /api/tickets/:ticketId/events` opens the SSE stream. It replays the
 * transcript after `Last-Event-ID` (the whole transcript when the header is
 * absent), then streams live. Each recorded event is sent with its sequence
 * number as the SSE id, so a reconnect resumes without a gap; deltas are sent
 * without an id and are absent from a replay. The stream stays open until the
 * client disconnects, and no response compression may be mounted in front of
 * it.
 *
 * `POST /api/tickets/:ticketId/input` takes one `ClientCommand`. It answers
 * 204 on success, 400 for a malformed command, 404 when the ticket has no
 * session, and 409 when a permission answer arrives for a request that is no
 * longer held. It never blocks on the agent.
 *
 * Neither route starts an agent for an unknown ticket: only the stream does,
 * so a stray POST cannot spawn a session.
 */
export type CreateChatRoutes = (
  dependencies: ChatDependencies,
) => Hono<{ Variables: LoggerVariables }>

export interface ChatDependencies {
  sessions: import('../sessions/types.ts').SessionRegistry
  transcript: import('../transcript/types.ts').TranscriptLog
}
