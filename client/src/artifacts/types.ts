import type { ArtifactContent, ArtifactRef, ArtifactTree, TicketId } from '@keel-web/protocol'

export type Unsubscribe = () => void

/**
 * One artefact the developer has open, as the tab strip shows it.
 *
 * `content` is absent until the first read answers. `error` is one sentence
 * for the developer and replaces the content rather than sitting beside it:
 * an artefact that cannot be read has nothing to show.
 */
export interface OpenArtifact {
  ref: ArtifactRef
  label: string
  content?: ArtifactContent
  error?: string
}

/** What the centre shows for one ticket. */
export interface CentreSnapshot {
  ticketId?: TicketId
  tree?: ArtifactTree
  open: readonly OpenArtifact[]
  /** Index into `open`, absent when nothing is open. */
  active?: number
  treeError?: string
}

/**
 * Holds what the centre shows, outside React.
 *
 * It lives outside React for the same reason the transcript does: the state
 * is driven by things that are not renders, and a store keeps two viewers of
 * the same ticket correct without either owning the other.
 *
 * What is open is remembered per ticket for as long as the page lives, so
 * moving between tickets and back restores the tabs rather than the empty
 * centre.
 */
export interface CentreStore {
  snapshot: () => CentreSnapshot
  subscribe: (listener: () => void) => Unsubscribe

  /** Points the centre at a ticket and reads its tree. Selecting the same ticket again is a no-op. */
  select: (ticketId: TicketId | undefined) => void

  /**
   * Opens an artefact and makes it the active tab.
   *
   * This is the one way the centre is pointed at anything, whoever asks: the
   * tree, a deep link, a link inside a document, or the workflow through a
   * hint. It is therefore deliberately blunt and carries no notion of who
   * asked.
   *
   * An artefact already open is activated rather than opened twice, and its
   * content is kept: a reference identifies an artefact, so opening it again
   * means "show me that one". The tab that was active stays in the strip, so
   * one click returns to it.
   *
   * Opening never scrolls, never focuses and never closes anything. What the
   * developer had is still there.
   */
  open: (ref: ArtifactRef) => void

  /** Makes an already open tab active. Out of range is ignored rather than throwing. */
  activate: (index: number) => void

  /**
   * Closes a tab. Closing the active one activates its neighbour, preferring
   * the one on the left, and closing the last one leaves nothing active.
   */
  close: (index: number) => void

  /**
   * Asks again for the active artefact, sending the entity tag it already
   * has, and replaces the content only when the answer is not 304.
   *
   * Called on an interval while the page is visible, which is how an open
   * view follows the file. Replacing content must not remount the scroll
   * container, so the developer's position in a document survives a rewrite
   * of it.
   */
  refresh: () => void

  /** Stops the interval and any request in flight. */
  dispose: () => void
}

export interface CentreStoreDependencies {
  workspaceId: string
  /** How often the active artefact is asked for again, in milliseconds. */
  interval?: number
}

export type CreateCentreStore = (dependencies: CentreStoreDependencies) => CentreStore
