import type { WorkspaceId } from '@keel-web/protocol'

/**
 * A repository keel-web works in, with what keel needs to know about it.
 *
 * `ticketRepository` and `tracker` come from `.claude/keel.json` in the
 * repository, so a workspace is added by naming a path, not by filling in a
 * form.
 */
export interface Workspace {
  id: WorkspaceId
  /** What the developer calls it, defaulting to the directory name. */
  name: string
  /** Absolute path of the repository the agent runs in. */
  path: string
  /**
   * Absolute path of the ticket repository, when keel.json names one.
   *
   * Everything keel-web records for this workspace lives under it, so a
   * workspace without one can be listed but cannot hold a session.
   */
  ticketRepository?: string
  tracker?: WorkspaceTracker
}

export interface WorkspaceTracker {
  source: 'github' | 'jira'
  repository: string
}

/**
 * Resolves a workspace to the repository it stands for.
 *
 * Everything that needs a working directory goes through this, so nothing
 * else has to know where a repository lives.
 */
export interface WorkspaceRegistry {
  /** Every known workspace, in a stable order. */
  list: () => readonly Workspace[]

  /**
   * The workspace with that id, or undefined for an unknown one.
   *
   * Callers must treat undefined as a rejected request rather than falling
   * back to a default: a wrong working directory runs an agent against the
   * wrong repository.
   */
  find: (id: WorkspaceId) => Workspace | undefined
}

/**
 * Builds the registry from configuration.
 *
 * Rejects when a configured path does not exist or holds no repository, so a
 * misconfiguration is visible at startup rather than at the first message.
 */
export type CreateWorkspaceRegistry = (paths: readonly string[]) => Promise<WorkspaceRegistry>
