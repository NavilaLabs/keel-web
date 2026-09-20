/**
 * What an `@` reference can name in a workspace.
 *
 * The browser never holds the repository's file list. It asks for the entries
 * one query matches and shows those, because a large repository is tens of
 * megabytes of paths and none of it is useful to a page that shows ten rows.
 */

export type FileEntryKind = 'file' | 'directory'

/**
 * One file or directory, as the completion offers it.
 *
 * `path` is relative to the workspace and uses forward slashes, which is what
 * gets written into the message as `@path` and what the agent resolves
 * against its own working directory. A directory carries no trailing slash
 * here; whoever inserts it decides what to write.
 */
export interface FileEntry {
  path: string
  kind: FileEntryKind
}

/**
 * The entries one query matched, best first.
 *
 * `truncated` says the index had more to offer than the limit allowed, so a
 * narrower query would find something this answer does not show. It is about
 * the answer, never about the index being incomplete.
 *
 * `reason` is one sentence for the developer, present exactly when no index
 * could be built at all. A workspace that is not a git repository is the case
 * this exists for: there is nothing to complete, and saying so is better than
 * an empty list that looks like a query with no matches.
 */
export interface FileMatches {
  entries: readonly FileEntry[]
  truncated: boolean
  reason?: string
}
