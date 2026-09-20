import type { Hono } from 'hono'
import type { LoggerVariables } from '../logging/types.js'

/**
 * The browser-facing surface of a session, mounted by the HTTP app.
 *
 * Two routes, both under the workspace and the ticket, because ticket 3 in
 * one repository is not ticket 3 in another:
 *
 * `GET /api/workspaces/:workspaceId/tickets/:ticketId/events` opens the SSE stream. It replays the
 * transcript after `Last-Event-ID` (the whole transcript when the header is
 * absent), then streams live. Each recorded event is sent with its sequence
 * number as the SSE id, so a reconnect resumes without a gap; deltas are sent
 * without an id and are absent from a replay. The stream stays open until the
 * client disconnects, and no response compression may be mounted in front of
 * it.
 *
 * A client that goes away is unsubscribed exactly once, however the departure
 * is noticed. A browser reload is therefore one attach and one detach, not a
 * detach that never comes and a subscriber left behind for the life of the
 * process.
 *
 * `POST /api/workspaces/:workspaceId/tickets/:ticketId/input` takes one
 * `ClientCommand`. It answers 204 on success, 400 for a malformed command, 404
 * when the session does not exist or the workspace is unknown, and 409 when a
 * permission answer arrives for a request that is no longer held. It never
 * blocks on the agent.
 *
 * Neither route starts an agent for an unknown session: only the stream does,
 * so a stray POST cannot spawn one. An unregistered workspace is refused by
 * both.
 */
export type CreateChatRoutes = (
  dependencies: ChatDependencies,
) => Hono<{ Variables: LoggerVariables }>

export interface ChatDependencies {
  sessions: import('../sessions/types.js').SessionRegistry
  transcript: import('../transcript/types.js').TranscriptLog
  workspaces: import('../workspaces/types.js').WorkspaceRegistry
}
