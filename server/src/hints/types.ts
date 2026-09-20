import type { Hono } from 'hono'
import type { ArtifactHint, TicketId } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'
import type { Workspace, WorkspaceRegistry } from '../workspaces/types.js'

export type Unsubscribe = () => void

/**
 * One hint as the server holds it, with where in the file it was found.
 *
 * The offset is the reading position after that line. It is what a returning
 * viewer sends back, so resuming is the same mechanism as reading on: keel
 * mints no hint id, and a reading position is a better one than anything we
 * could invent.
 */
export interface ReadHint {
  offset: number
  hint: ArtifactHint
}

/**
 * Follows a ticket's event stream and passes on the hints appended to it.
 *
 * keel appends to `tickets/<id>/events.jsonl` as the workflow runs, from a
 * separate process, and that file is tracked by git, so a checkout can
 * replace it wholesale. Nothing here may assume it grows monotonically, and
 * nothing may fail because it does not exist yet: a ticket keel has not
 * touched has no stream, which is a normal state and not an error.
 */
export interface HintFollower {
  /**
   * Calls the listener for every hint appended from `after` onwards.
   *
   * With no `after`, the listener hears what is appended from now on, and
   * nothing that was already in the file. That is the rule keel states for
   * consumers: what is in the file on arrival is history, and acting on it
   * would drag the view somewhere the developer has long left.
   *
   * With an `after`, reading resumes at that offset, which is how a viewer
   * that reconnected within a moment does not miss what it was sent while
   * away. A file shorter than the offset was replaced, and reading starts
   * from its end rather than from the middle of something else.
   *
   * Hints older than the freshness window are dropped rather than delivered:
   * a laptop that slept for an hour reconnects with a valid offset, and the
   * hints it missed are no longer worth acting on. A reload takes seconds,
   * so the window separates the two cases cleanly.
   *
   * Following changes nothing and is safe to abandon. Unsubscribing stops
   * the reading, and the last listener leaving stops watching the file.
   */
  follow: (
    workspace: Workspace,
    ticketId: TicketId,
    listener: (hint: ReadHint) => void,
    after?: number,
  ) => Unsubscribe
}

export interface HintFollowerOptions {
  /** How old a hint may be and still be acted on, in milliseconds. */
  freshness?: number
  /** How often the file is checked, in milliseconds. */
  interval?: number
}

export type CreateHintFollower = (options?: HintFollowerOptions) => HintFollower

/**
 * The browser-facing surface of the hint follower, mounted by the HTTP app.
 *
 * `GET /api/workspaces/:workspaceId/tickets/:ticketId/hints` is a
 * Server-Sent Events stream of `artifact.hint` messages. It starts an agent
 * for nothing and needs no session: a developer reading the artefacts of a
 * ticket with no chat open still gets pointed at the right one.
 *
 * The SSE id of each message is the reading position after it, so a browser
 * reconnecting sends `Last-Event-ID` and resumes exactly there. A first
 * connection carries no id and hears only what arrives from then on.
 *
 * Nothing is ever re-sent to a viewer that already had it, which is what
 * makes the hint a one-shot rather than something that keeps pulling the
 * view back.
 */
export type CreateHintRoutes = (
  dependencies: HintDependencies,
) => Hono<{ Variables: LoggerVariables }>

export interface HintDependencies {
  hints: HintFollower
  workspaces: WorkspaceRegistry
}
