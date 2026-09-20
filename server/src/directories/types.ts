import type { Hono } from 'hono'
import type { DirectoryListing } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'

/**
 * Walks the directories of the machine keel-web runs on.
 *
 * It exists because the browser cannot: a repository is picked here and added
 * by its absolute path. Nothing it returns is remembered, and nothing it does
 * changes anything on disk.
 */
export interface DirectoryBrowser {
  /**
   * Lists the subdirectories of that path.
   *
   * With no path, lists the home directory of whoever started the server,
   * which is where a developer keeps their repositories. A leading `~/` is
   * expanded; anything else must be absolute, because a relative path would
   * resolve against wherever the server happens to have been started and
   * that is not a place the developer is thinking about.
   *
   * Rejects with `UnreadableDirectoryError` when the path is not a directory
   * or cannot be read, carrying a sentence that names the path. A single
   * unreadable entry inside a readable directory is left out of the listing
   * rather than failing it, so one root-owned folder does not hide the rest.
   */
  list: (path?: string) => Promise<DirectoryListing>
}

export type CreateDirectoryBrowser = () => DirectoryBrowser

/** The path is not a directory this process can read. */
export class UnreadableDirectoryError extends Error {
  override readonly name = 'UnreadableDirectoryError'
}

/**
 * The browser-facing surface of the directory browser, mounted by the HTTP app.
 *
 * `GET /api/directories` answers with the home directory, and
 * `GET /api/directories?path=<absolute>` with that directory. It answers 200
 * with a `DirectoryListing`, or 400 with the reason when the path cannot be
 * read.
 *
 * It is a read of the filesystem and changes nothing, so it is safe to repeat
 * and safe to abandon.
 */
export type CreateDirectoryRoutes = (
  dependencies: DirectoryDependencies,
) => Hono<{ Variables: LoggerVariables }>

export interface DirectoryDependencies {
  directories: DirectoryBrowser
}
