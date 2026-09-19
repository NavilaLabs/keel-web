import type { WorkspaceSummary } from '@keel-web/protocol'

export type { WorkspaceSummary }

/**
 * The workspaces the sidebar shows, and the two things it can do to them.
 *
 * The list is fetched once and then kept in step by the answers to `add` and
 * `remove`, each of which returns the whole new list. There is no polling and
 * no second fetch: the server's answer to a change is the change.
 *
 * `error` holds the last failed attempt as a sentence to show beside the
 * input, and is cleared by the next attempt. A failed add leaves the list
 * untouched.
 */
export interface Workspaces {
  workspaces: readonly WorkspaceSummary[]
  loading: boolean
  error?: string

  /**
   * Adds the repository at that path.
   *
   * Resolves whether or not the path was accepted; a rejection surfaces as
   * `error`, never as a thrown exception, because the caller is a click
   * handler.
   */
  add: (path: string) => Promise<void>

  /** Removes that workspace. Removing one that is already gone does nothing. */
  remove: (id: string) => Promise<void>
}

export type UseWorkspaces = () => Workspaces
