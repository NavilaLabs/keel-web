import type { FileMatches, WorkspaceId } from '@keel-web/protocol'
import type { Hono } from 'hono'
import type { LoggerVariables } from '../logging/types.js'

/**
 * Answers what an `@` reference can name in a workspace.
 *
 * The list comes from git, so it is the tracked files plus the untracked ones
 * no ignore rule covers, and the directories those files lie in. That is the
 * same set the terminal completes from, and it is why a workspace with no git
 * repository has nothing to offer rather than a half-right list built another
 * way.
 *
 * The index is built per workspace and kept, because walking a repository on
 * every keystroke is not something a completion can afford. It is rebuilt
 * when it is older than the freshness the implementation promises, and the
 * kept one is answered from meanwhile: a file the agent wrote a moment ago
 * may be missing from one answer and present from the next.
 */
export interface FileIndex {
  /**
   * The entries matching `query`, best first, at most `limit` of them.
   *
   * An empty query is not an error: it answers the entries the workspace
   * starts with, which is what an `@` with nothing typed after it shows.
   * Matching is on the whole path and never case-sensitive.
   *
   * Never rejects for anything about the repository. A workspace that has no
   * git repository, a git that cannot be run and a repository that cannot be
   * read all answer with no entries and a `reason`. It rejects only with
   * `UnknownWorkspaceError`, for a workspace that is not registered.
   *
   * Safe to call concurrently. Calls that arrive while an index is being
   * built wait for that one build rather than starting their own.
   */
  matches(workspaceId: WorkspaceId, query: string, limit: number): Promise<FileMatches>
}

/**
 * The browser-facing surface of the file index, mounted by the HTTP app.
 *
 * `GET /api/workspaces/:workspaceId/files?query=<text>&limit=<n>` answers a
 * `FileMatches`. The route is scoped to the workspace rather than to a
 * ticket, because what an `@` can name does not depend on which ticket is
 * open.
 *
 * It answers 404 for an unknown workspace and 400 for a limit that is not a
 * positive number. A missing query is an empty query, and a missing limit is
 * the route's own, which is small: this answers a popup, not a file browser.
 *
 * No path from the request ever reaches the filesystem. The only paths it can
 * answer with are the ones git listed, so there is nothing here for a
 * traversal to reach.
 */
export type CreateFileRoutes = (
  dependencies: FileDependencies,
) => Hono<{ Variables: LoggerVariables }>

export interface FileDependencies {
  files: FileIndex
  workspaces: import('../workspaces/types.js').WorkspaceRegistry
}
