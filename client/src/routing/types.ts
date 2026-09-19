import type { TicketId } from '@keel-web/protocol'

/**
 * Which centre view is showing.
 *
 * Only `none` exists in this ticket; the ticket, pull request and diagram
 * views arrive later and add their own names.
 */
export type CentreView = 'none'

export interface Route {
  /** Absent when no ticket is selected. */
  ticketId?: TicketId
  view: CentreView
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
