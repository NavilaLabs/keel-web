import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { DirectoryEntry, DirectoryListing } from '@keel-web/protocol'
import {
  UnreadableDirectoryError,
  type CreateDirectoryBrowser,
  type DirectoryBrowser,
} from './types.js'

/** Only `~/`, and otherwise absolute: a relative path would resolve against the server's own cwd. */
function absoluteOf(path: string): string {
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  if (path === '~') return homedir()
  if (!isAbsolute(path)) {
    throw new UnreadableDirectoryError(`${path} is not an absolute path.`)
  }
  return resolve(path)
}

/** A symlink to a directory is a directory here, which is how the developer sees it. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export const createDirectoryBrowser: CreateDirectoryBrowser = (): DirectoryBrowser => ({
  async list(path) {
    const target = path === undefined || path === '' ? homedir() : absoluteOf(path)

    let found
    try {
      found = await readdir(target, { withFileTypes: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EACCES') throw new UnreadableDirectoryError(`No permission to read ${target}.`)
      if (code === 'ENOTDIR') throw new UnreadableDirectoryError(`${target} is not a directory.`)
      throw new UnreadableDirectoryError(`There is nothing at ${target}.`)
    }

    const named = found.filter((entry) => !entry.name.startsWith('.'))
    const entries: DirectoryEntry[] = []
    for (const entry of named) {
      const full = join(target, entry.name)
      // A symlink needs the extra stat; a plain directory does not, and most
      // entries are plain.
      if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(full)))) {
        entries.push({ name: entry.name, path: full })
      }
    }
    entries.sort((one, other) => one.name.localeCompare(other.name, undefined, { numeric: true }))

    const above = dirname(target)
    const listing: DirectoryListing = {
      path: target,
      entries,
      ...(above !== target && { parent: above }),
    }
    return listing
  },
})
