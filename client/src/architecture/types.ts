import type { ArchitectureView, ArtifactRef } from '@keel-web/protocol'

/**
 * Draws one laid-out architecture view.
 *
 * The model arrives ready to draw, so this renders and reports; it never
 * parses, never lays out and never fetches. Keeping it that way is what lets
 * the same component show the as-is model and a ticket's to-be model without
 * knowing the difference.
 */
export interface DiagramViewProps {
  view: ArchitectureView

  /**
   * The developer clicked through to another view of the same model.
   *
   * Reported rather than handled, so navigation lands in the centre's tabs
   * and the URL instead of a place of its own inside the diagram.
   */
  onNavigate?: (view: string) => void

  /**
   * The developer followed a `link` attribute of an element.
   *
   * Those links are relative filesystem paths from the ticket repository into
   * the code repository, which a browser would resolve against the page URL
   * and land nowhere. They are therefore never followed as ordinary links:
   * one that resolves to a readable file is reported as the artefact it
   * names, and the centre opens it. One that resolves to nothing is reported
   * as `undefined`, and the caller says so rather than navigating away.
   */
  onFollowLink?: (ref: ArtifactRef | undefined, href: string) => void
}
