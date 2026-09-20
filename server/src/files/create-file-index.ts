import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FileEntry, FileMatches, WorkspaceId } from '@keel-web/protocol'
import type { Logger } from '../logging/types.js'
import { UnknownWorkspaceError } from '../sessions/types.js'
import type { WorkspaceRegistry } from '../workspaces/types.js'
import { rank } from './rank.js'
import type { FileIndex } from './types.js'

const run = promisify(execFile)

export interface FileIndexOptions {
  workspaces: WorkspaceRegistry
  logger: Logger
  /** How long a built index is answered from before it is rebuilt behind the answer. */
  freshForMs?: number
}

interface Index {
  entries: readonly FileEntry[]
  builtAt: number
  reason?: string
}

const listing = ['ls-files', '--cached', '--others', '--exclude-standard', '-z']

/** How deep the path sits, which is what orders an index nobody has typed into yet. */
function depthOf(path: string): number {
  let depth = 0
  for (const character of path) if (character === '/') depth += 1
  return depth
}

/**
 * The directories the listed files lie in.
 *
 * Derived rather than listed, because git has no notion of an empty directory
 * and an empty one is nothing an `@` reference would want to name anyway.
 */
function directoriesOf(paths: readonly string[]): string[] {
  const found = new Set<string>()
  for (const path of paths) {
    let cut = path.indexOf('/')
    while (cut !== -1) {
      found.add(path.slice(0, cut))
      cut = path.indexOf('/', cut + 1)
    }
  }
  return [...found]
}

function orderedEntries(paths: readonly string[]): FileEntry[] {
  const entries: FileEntry[] = [
    ...directoriesOf(paths).map((path) => ({ path, kind: 'directory' as const })),
    ...paths.map((path) => ({ path, kind: 'file' as const })),
  ]
  entries.sort((one, other) => {
    const byDepth = depthOf(one.path) - depthOf(other.path)
    return byDepth === 0 ? one.path.localeCompare(other.path) : byDepth
  })
  return entries
}

function reasonFor(repository: string, error: unknown): string {
  const output = error instanceof Error ? error.message : String(error)
  if (output.includes('not a git repository')) {
    return `${repository} is not a git repository, so there is nothing to complete.`
  }
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return 'git is not on this machine, so file references cannot be completed.'
  }
  return `git could not list the files in ${repository}.`
}

export function createFileIndex(options: FileIndexOptions): FileIndex {
  const { workspaces, logger } = options
  const freshForMs = options.freshForMs ?? 5_000

  const held = new Map<WorkspaceId, Index>()
  const building = new Map<WorkspaceId, Promise<Index>>()

  async function build(workspaceId: WorkspaceId, repository: string): Promise<Index> {
    try {
      const { stdout } = await run('git', listing, {
        cwd: repository,
        // The agent runs git in this same repository while this is listing it.
        // Taking the index lock for a completion would make the two wait on
        // each other for nothing.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
        maxBuffer: 256 * 1024 * 1024,
      })
      const paths = stdout.split('\0').filter((path) => path !== '')
      const index: Index = { entries: orderedEntries(paths), builtAt: Date.now() }
      held.set(workspaceId, index)
      return index
    } catch (error) {
      const index: Index = {
        entries: [],
        builtAt: Date.now(),
        reason: reasonFor(repository, error),
      }
      held.set(workspaceId, index)
      logger.warn({ workspaceId, err: String(error) }, 'no file index for this workspace')
      return index
    }
  }

  /** Builds at most once per workspace at a time, however many callers ask. */
  function buildOnce(workspaceId: WorkspaceId, repository: string): Promise<Index> {
    const inFlight = building.get(workspaceId)
    if (inFlight !== undefined) return inFlight
    const attempt = build(workspaceId, repository).finally(() => building.delete(workspaceId))
    building.set(workspaceId, attempt)
    return attempt
  }

  return {
    async matches(workspaceId, query, limit) {
      const workspace = workspaces.find(workspaceId)
      if (workspace === undefined) {
        throw new UnknownWorkspaceError(`No workspace is registered as ${workspaceId}.`)
      }

      const current = held.get(workspaceId)
      let index: Index
      if (current === undefined) {
        index = await buildOnce(workspaceId, workspace.path)
      } else {
        index = current
        // Answered from what is held, rebuilt behind the answer, so a
        // keystroke never waits for git twice.
        if (Date.now() - current.builtAt > freshForMs) void buildOnce(workspaceId, workspace.path)
      }

      const found = rank(index.entries, query, limit)
      const answer: FileMatches = {
        entries: found.entries,
        truncated: found.truncated,
        ...(index.reason !== undefined && { reason: index.reason }),
      }
      return answer
    },
  }
}
