import type { Hono } from 'hono'
import type { ArtifactContent, ArtifactRef, ArtifactTree, TicketId } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'
import type { Workspace, WorkspaceRegistry } from '../workspaces/types.js'

/**
 * What the tree needs to know about the architecture model, and no more.
 *
 * The views of a model are not files, so they cannot be found by walking a
 * directory, and reading them needs a parser this module has no business
 * carrying. It asks for the names only. Anything that can answer with view
 * names satisfies this, including nothing at all: an implementation that
 * returns an empty list leaves the tree correct and one section shorter.
 */
export interface ArchitectureViewSource {
  views: (workspace: Workspace, branch?: string) => Promise<readonly string[]>
}

/**
 * Reads the artefacts of a ticket out of the two repositories a workspace
 * stands for.
 *
 * The ticket repository holds `knowledge.md`, the ADRs and the architecture
 * sources; the code repository holds the frozen stubs. Both are the
 * developer's own repositories on this machine, and this reads them and
 * nothing else: it writes nothing, remembers nothing and creates nothing.
 */
export interface ArtifactReader {
  /**
   * What the developer can open for that ticket.
   *
   * Everything in the ticket's own directory is offered, whatever it is,
   * including files keel-web has no special view for. A file that was put
   * there for the developer must not be unreachable because this code does
   * not recognise it; being able to open it is worth more than a tidy list.
   * The architecture directory is added for its views and sources, and the
   * stubs come from what `state.json` records for the ticket's blocks.
   *
   * `state.json` decides order and emphasis, not membership: an artefact it
   * names is marked `named`, an ADR it names from another ticket's directory
   * is included even though it lives outside this ticket, and a file it does
   * not mention is still offered.
   *
   * The groups are fixed, and ordered by what a developer reaches for rather
   * than by where the files sit:
   *
   * - the ticket itself: `knowledge.md`, and beside it anything else lying
   *   directly in the ticket's directory that is not one of the files named
   *   below. A file left there deliberately belongs in front, not in a
   *   leftovers drawer
   * - the decisions: the ADRs, labelled with their heading rather than their
   *   file name
   * - the contracts: the stubs, grouped by block and labelled with the
   *   symbol rather than the path
   * - the architecture: the views of the ticket's own branch, with the `.c4`
   *   sources in a group of their own below them
   * - the workflow: `state.json` and `events.jsonl`, and with them the
   *   hook's snapshot cache and keel-web's own transcript. All four are
   *   openable so that nothing is invisible, and none is emphasised
   *
   * The code repository is entered only for the stubs `state.json` names.
   * Offering the rest of it would make this a file browser for someone
   * else's repository, which an editor does better, and would reopen the
   * surface ADR 0015 closed.
   *
   * A workspace with no ticket repository, or a ticket keel has not worked
   * yet, yields an empty tree carrying `reason`. That is an answer, not a
   * failure.
   */
  tree: (workspace: Workspace, ticketId: TicketId) => Promise<ArtifactTree>

  /**
   * One artefact's content.
   *
   * The path is resolved and canonicalised, then required to lie inside the
   * repository the reference names. A symlink pointing out of the repository
   * is therefore refused rather than followed, which string comparison alone
   * would not catch. Rejects with `ArtifactOutsideWorkspaceError` when it
   * escapes, and with `UnreadableArtifactError` when it is missing or cannot
   * be read, each carrying a sentence naming the artefact.
   *
   * For a stub whose sha256 `state.json` recorded, the answer carries both
   * fingerprints and whether they still match. A mismatch is expected from
   * step 8 on and is reported, never hidden and never treated as an error.
   *
   * A `c4View` reference is not a file and is refused here; it is read
   * through the architecture reader.
   *
   * The ticket is named because the frozen hash lives in that ticket's
   * `state.json`. The same file can be a stub of more than one ticket, so
   * searching for it would report a fingerprint from whichever ticket was
   * looked at first, which is worse than reporting none.
   */
  read: (workspace: Workspace, ticketId: TicketId, ref: ArtifactRef) => Promise<ArtifactContent>
}

export type CreateArtifactReader = (dependencies: ArtifactReaderDependencies) => ArtifactReader

export interface ArtifactReaderDependencies {
  architecture: ArchitectureViewSource
}

/** The resolved path lies outside the repository it was read from. */
export class ArtifactOutsideWorkspaceError extends Error {
  override readonly name = 'ArtifactOutsideWorkspaceError'
}

/** The artefact is missing, or this process cannot read it. */
export class UnreadableArtifactError extends Error {
  override readonly name = 'UnreadableArtifactError'
}

/**
 * The browser-facing surface of the artefact reader, mounted by the HTTP app.
 *
 * `GET /api/workspaces/:workspaceId/tickets/:ticketId/artifacts` answers with
 * the tree. `GET .../artifacts/content` takes the reference as query
 * parameters and answers with the content, or 404 when it is missing and 400
 * when it escapes the repository, each with a reason for the developer.
 *
 * Both answers carry an `ETag`. A request repeating it in `If-None-Match` is
 * answered 304 with no body, which is how an open view stays current without
 * a channel of its own: it asks again, cheaply, while it is open.
 *
 * Both are reads. They change nothing, they are safe to repeat and safe to
 * abandon.
 */
export type CreateArtifactRoutes = (
  dependencies: ArtifactDependencies,
) => Hono<{ Variables: LoggerVariables }>

export interface ArtifactDependencies {
  artifacts: ArtifactReader
  workspaces: WorkspaceRegistry
}
