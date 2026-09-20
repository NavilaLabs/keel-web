/**
 * The wire contract for the artefacts of a ticket.
 *
 * An artefact is something keel produced while working a ticket and the
 * developer reads: `knowledge.md`, an ADR, a frozen stub, a view of the
 * architecture model. keel-web only ever reads them.
 */

import type { TicketId } from './events.js'

/** Which repository a path is relative to. */
export type ArtifactRepository = 'ticket' | 'code'

/**
 * What an artefact is, which is also what decides how it is rendered.
 *
 * The first four names are the ones keel's own `artifact_hint` uses, so a hint
 * target maps onto a reference without translation. The rest exist because the
 * developer browses the ticket's own directory rather than a list of what
 * keel-web recognises.
 *
 * `file` is anything else that lies there: a file keel was asked to leave for
 * the developer, a note, an export. It is shown as text and nothing more,
 * which is little, but being able to find it is the point. A kind is never
 * withheld because the content cannot be rendered well.
 */
export type ArtifactKind =
  | 'knowledge'
  | 'adr'
  | 'stub'
  | 'c4View'
  | 'document'
  | 'c4Source'
  | 'file'

/**
 * What addresses one artefact.
 *
 * This is the identity the tree, the open tabs and the URL all use, so two
 * references that name the same artefact must be equal field by field.
 *
 * A view is not a file: it is a name inside the model, and the model it
 * belongs to lives on a branch. `branch` absent means the branch the ticket
 * repository is currently on, which is what a developer browsing sees.
 */
export type ArtifactRef =
  | {
      kind: 'knowledge' | 'adr' | 'document' | 'c4Source' | 'file'
      repository: 'ticket'
      /** Relative to the repository root, never absolute and never leaving it. */
      path: string
    }
  | {
      kind: 'stub'
      repository: 'code'
      path: string
      /** The declared contract, as `state.json` recorded it. */
      symbol?: string
    }
  | {
      kind: 'c4View'
      view: string
      branch?: string
    }

/**
 * One entry of the artefact tree.
 *
 * A group is a directory or a heading the server introduced; it is never
 * openable on its own. `named` marks an artefact `state.json` lists in
 * `artifacts` or in a block's `claimed_stubs`, which is what the tree
 * emphasises. Everything else is browsable but quiet.
 */
export type ArtifactNode =
  | { type: 'group'; label: string; children: ArtifactNode[] }
  | { type: 'artifact'; label: string; ref: ArtifactRef; named: boolean }

/**
 * The artefacts of one ticket, in the order they should be offered.
 *
 * Ordering is the server's, because it is the side that reads `state.json`.
 * An empty tree is a legitimate answer for a ticket keel has not worked yet,
 * and `reason` then says so in one sentence written for the developer.
 */
export interface ArtifactTree {
  ticketId: TicketId
  nodes: ArtifactNode[]
  reason?: string
}

/**
 * Whether a stub still says what it said when the contract was frozen.
 *
 * `frozen` is the sha256 from `state.json`. From step 8 on, the file is
 * expected to grow an implementation, so a mismatch is information rather
 * than an error, and the view says so rather than hiding it.
 */
export interface StubFingerprint {
  frozen: string
  current: string
  matches: boolean
}

/**
 * One artefact's content as the browser receives it.
 *
 * `etag` is what a conditional request sends back: an open view asks again
 * with it and is answered 304 while nothing changed. It is derived from the
 * content, so the same bytes always yield the same tag.
 */
export interface ArtifactContent {
  ref: ArtifactRef
  text: string
  etag: string
  /** Present only for a stub whose fingerprint `state.json` recorded. */
  fingerprint?: StubFingerprint
}

