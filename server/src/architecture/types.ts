import type { Hono } from 'hono'
import type { ArchitectureView } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'
import type { Workspace, WorkspaceRegistry } from '../workspaces/types.js'

/**
 * Reads the architecture model of a branch and lays its views out.
 *
 * The model is LikeC4 source in the ticket repository, and `main` holds the
 * as-is state while a ticket's to-be state lives on that ticket's branch. A
 * view id therefore names nothing on its own, which is why every read here
 * takes a branch as well.
 *
 * Parsing and layout happen here rather than in the browser: layout needs
 * Graphviz, the sources are on this machine, and the browser should receive
 * something ready to draw.
 */
export interface ArchitectureReader {
  /**
   * The views the model on that branch defines.
   *
   * Used to offer them in the artefact tree. A branch whose model does not
   * parse yields an empty list rather than throwing, because a half-written
   * model during step 7 is a normal state of affairs and must not take the
   * rest of the tree down with it.
   */
  views: (workspace: Workspace, branch?: string) => Promise<readonly string[]>

  /**
   * One view, laid out.
   *
   * The sources are read from the branch's committed tree, except when the
   * branch is the one the ticket repository currently has checked out: then
   * the working tree is read, because that is what the developer sees. Both
   * halves of that rule handle unpushed commits correctly.
   *
   * Rejects with `UnknownArchitectureViewError` when the model has no such
   * view, and with `UnreadableArchitectureError` when the branch is unknown
   * or the sources do not parse, carrying the parser's own complaint so a
   * broken model can be fixed from what the browser shows.
   *
   * The `etag` identifies the sources the answer was produced from, so an
   * open diagram can ask again and be told nothing changed.
   */
  view: (workspace: Workspace, view: string, branch?: string) => Promise<ArchitectureView>
}

export type CreateArchitectureReader = () => ArchitectureReader

/** The model on that branch defines no such view. */
export class UnknownArchitectureViewError extends Error {
  override readonly name = 'UnknownArchitectureViewError'
}

/** The branch is unknown, or its architecture sources do not parse. */
export class UnreadableArchitectureError extends Error {
  override readonly name = 'UnreadableArchitectureError'
}

/**
 * The browser-facing surface of the architecture reader, mounted by the HTTP
 * app.
 *
 * `GET /api/workspaces/:workspaceId/architecture` takes a view and an
 * optional branch and answers with the laid-out model, 404 when the model
 * has no such view and 400 when the branch or the sources cannot be read,
 * each with a reason written for the developer.
 *
 * It answers with an `ETag` and honours `If-None-Match` with a 304, the same
 * way the artefact routes do, so an open diagram follows its sources without
 * a channel of its own.
 *
 * It is a read. It changes nothing, and it is safe to repeat and to abandon.
 */
export type CreateArchitectureRoutes = (
  dependencies: ArchitectureDependencies,
) => Hono<{ Variables: LoggerVariables }>

export interface ArchitectureDependencies {
  architecture: ArchitectureReader
  workspaces: WorkspaceRegistry
}
