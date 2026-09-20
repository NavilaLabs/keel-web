/**
 * The wire contract for the architecture model keel keeps in LikeC4.
 *
 * `main` of the ticket repository holds the as-is model and a ticket branch
 * holds that ticket's to-be model, so nothing here identifies a view without
 * also saying which branch it came from.
 */

/**
 * One view of the model, laid out and ready to draw.
 *
 * `model` is likec4's own layouted model data, opaque here: this package
 * describes the wire and does not depend on likec4. The side that draws it
 * types it through likec4 itself.
 *
 * `branch` is the branch the sources were read from, echoed back rather than
 * assumed, because a view id alone does not say which model it belongs to.
 *
 * `etag` identifies the sources this was produced from, so an open diagram
 * can ask again and be told that nothing changed.
 */
export interface ArchitectureView {
  view: string
  branch: string
  model: unknown
  etag: string
}
