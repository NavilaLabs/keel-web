import type { ArtifactRef, TicketId, WorkspaceId } from '@keel-web/protocol'

/**
 * Which centre view is showing.
 *
 * `artifact` covers every kind of artefact, diagrams included, because an
 * `ArtifactRef` already distinguishes them. The ticket and pull request
 * views arrive later and add their own names.
 */
export type CentreView = 'none' | 'artifact'

export interface Route {
  /** Absent when no workspace is selected. */
  workspaceId?: WorkspaceId
  /** Absent when no ticket is selected, and meaningless without a workspace. */
  ticketId?: TicketId
  view: CentreView
  /**
   * Present exactly when `view` is `artifact`.
   *
   * It travels as query parameters rather than path segments: an artefact
   * path contains slashes of its own, and leaving the path grammar alone
   * keeps it free for the ticket and pull request views. An unparsable or
   * incomplete artefact yields `view: 'none'` rather than a broken
   * reference, so a mangled link lands on the ticket instead of an error.
   */
  artifact?: ArtifactRef
}

export type Unsubscribe = () => void

/**
 * The URL as the source of truth for what is on screen.
 *
 * Everything reads the selected ticket through this, so replacing it with a
 * router later touches this module only.
 */
export interface Router {
  /** Parsed from the current URL. An unparsable URL yields no ticket rather than throwing. */
  current: () => Route

  /** Pushes a history entry, so the back button returns to the previous ticket. */
  navigate: (route: Route) => void

  /** Fires on back and forward, never on `navigate`. */
  subscribe: (listener: () => void) => Unsubscribe
}
