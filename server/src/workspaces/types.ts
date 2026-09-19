import type { Hono } from 'hono'
import type { WorkspaceId, WorkspaceSummary, WorkspaceTracker } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'

export type { WorkspaceTracker }

/**
 * A repository keel-web works in, with what keel needs to know about it.
 *
 * `ticketRepository` and `tracker` come from `.claude/keel.json` in the
 * repository, so a workspace is added by naming a path, not by filling in a
 * form. Both are absent while the path cannot be reached, because nothing can
 * be read from a directory that is not there.
 */
export interface Workspace {
  id: WorkspaceId
  /** What the developer calls it, defaulting to the directory name. */
  name: string
  /** Absolute path of the repository the agent runs in. */
  path: string
  /** False when the path is gone, so the entry survives an unmounted drive. */
  reachable: boolean
  /**
   * Absolute path of the ticket repository, when keel.json names one.
   *
   * Everything keel-web records for this workspace lives under it, so a
   * workspace without one can be listed but cannot hold a session.
   */
  ticketRepository?: string
  tracker?: WorkspaceTracker
}

/**
 * Resolves a workspace to the repository it stands for, and owns which
 * repositories are known at all.
 *
 * Everything that needs a working directory goes through this, so nothing else
 * has to know where a repository lives. Reading is synchronous against a view
 * held in memory; only the three methods that touch the filesystem are not.
 * That view is as fresh as the last `refresh`, which is honest rather than
 * ideal: a path can disappear without keel-web being told.
 */
export interface WorkspaceRegistry {
  /** Every known workspace, in the order they were added. */
  list: () => readonly Workspace[]

  /**
   * The workspace with that id, or undefined for an unknown one.
   *
   * Callers must treat undefined as a rejected request rather than falling
   * back to a default: a wrong working directory runs an agent against the
   * wrong repository.
   */
  find: (id: WorkspaceId) => Workspace | undefined

  /**
   * Remembers a repository and returns the list it now belongs to.
   *
   * The path is expanded, resolved and required to be an existing directory;
   * `NotADirectoryError` says which of those failed, in a sentence for the
   * developer. Neither a keel configuration nor a git repository is required:
   * a directory that has neither is added and reports why it cannot hold a
   * session yet.
   *
   * Adding a path that is already known returns the list unchanged rather than
   * a second entry for one directory. Concurrent calls are serialised, so a
   * double click cannot lose an entry.
   */
  add: (path: string) => Promise<readonly Workspace[]>

  /**
   * Forgets a repository and returns the list without it.
   *
   * Nothing on disk is touched: the repository, its tickets and its transcripts
   * stay where they are, and adding the same path again produces a new entry
   * rather than reviving the old id. Removing an unknown id is not an error,
   * so a second click is harmless.
   */
  remove: (id: WorkspaceId) => Promise<readonly Workspace[]>

  /**
   * Re-reads every known path and returns the updated list.
   *
   * This is where a vanished path becomes unreachable and a newly written
   * `.claude/keel.json` starts counting. Ids are kept, because identity is
   * remembered rather than derived from what is on disk. Never rejects for a
   * single bad path: that path becomes unreachable and the others are still
   * returned.
   */
  refresh: () => Promise<readonly Workspace[]>
}

/**
 * Builds the registry from the remembered list.
 *
 * Every remembered path is read once, so the first `list` is already accurate.
 * A path that cannot be read is listed as unreachable rather than rejected:
 * keel-web starting is not conditional on every repository still being there.
 */
export type CreateWorkspaceRegistry = (store: WorkspaceStore) => Promise<WorkspaceRegistry>

/** What is remembered about a repository between restarts: where it is, and who it is. */
export interface RememberedWorkspace {
  id: WorkspaceId
  path: string
}

/**
 * The developer's list of added repositories, kept in their configuration
 * directory.
 *
 * It holds paths and ids and nothing else. Names, trackers and ticket
 * repositories are read from each repository on every start, so this file
 * never becomes a second, staler answer to a question the repository already
 * answers.
 */
export interface WorkspaceStore {
  /**
   * The remembered list, or an empty one when nothing has been added yet.
   *
   * Rejects with `UnreadableStoreError` when the file exists but cannot be
   * parsed. The list holds paths the developer typed, so a broken file is
   * reported rather than replaced.
   */
  read: () => Promise<readonly RememberedWorkspace[]>

  /**
   * Replaces the remembered list.
   *
   * Written through a temporary file in the same directory and renamed over
   * the old one, so a reader never sees half a list. Calls are serialised
   * within this process; a second keel-web writing the same file is not
   * coordinated with, and the loser of that race loses its last change.
   */
  write: (workspaces: readonly RememberedWorkspace[]) => Promise<void>
}

/**
 * Builds the store over the file in the developer's configuration directory.
 *
 * The path follows the XDG base directory specification: `$XDG_CONFIG_HOME`
 * when it is set to an absolute path, and `~/.config` otherwise, which is what
 * the specification prescribes for an unset, empty or relative value.
 */
export type CreateWorkspaceStore = (options?: { directory?: string }) => WorkspaceStore

/** The remembered list exists but could not be read. */
export class UnreadableStoreError extends Error {
  override readonly name = 'UnreadableStoreError'
}

/** The path is not a directory that can be added. */
export class NotADirectoryError extends Error {
  override readonly name = 'NotADirectoryError'
}

/**
 * The browser-facing surface of the workspace list, mounted by the HTTP app.
 *
 * `GET /api/workspaces` refreshes and returns every workspace as a
 * `WorkspaceSummary`, so the sidebar reflects the filesystem as it is now
 * rather than as it was at startup.
 *
 * `POST /api/workspaces` takes `{ path }` and answers 201 with the whole new
 * list, so the browser never has to ask again to stay in step. It answers 400
 * for a path that is not a directory, with the reason in the body.
 *
 * `DELETE /api/workspaces/:id` answers 200 with the whole new list, and does
 * the same for an id that was already gone.
 *
 * None of these routes starts, stops or touches a session. Removing a
 * workspace whose session is running leaves that session alone; it ends when
 * the server does.
 */
export type CreateWorkspaceRoutes = (
  dependencies: WorkspaceDependencies,
) => Hono<{ Variables: LoggerVariables }>

export interface WorkspaceDependencies {
  workspaces: WorkspaceRegistry
}

/** How a workspace is described to the browser. */
export type SummariseWorkspace = (workspace: Workspace) => WorkspaceSummary
