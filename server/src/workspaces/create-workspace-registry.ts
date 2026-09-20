import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { WorkspaceId } from '@keel-web/protocol'
import {
  NotADirectoryError,
  type CreateWorkspaceRegistry,
  type RememberedWorkspace,
  type Workspace,
  type WorkspaceRegistry,
  type WorkspaceStore,
  type WorkspaceTracker,
} from './types.js'

interface KeelConfiguration {
  ticket_repo?: string
  tickets?: { source?: string; repository?: string }
}

function trackerOf(configuration: KeelConfiguration): WorkspaceTracker | undefined {
  const { source, repository } = configuration.tickets ?? {}
  if (repository === undefined) return undefined
  if (source !== 'github' && source !== 'jira') return undefined
  return { source, repository }
}

/** Only `~/`, because `~user` needs a passwd lookup that no shell-free path can do. */
function expand(path: string): string {
  if (!path.startsWith('~/')) return path
  return join(homedir(), path.slice(2))
}

function absolute(path: string): string {
  return resolve(expand(path))
}

async function readConfiguration(path: string): Promise<KeelConfiguration> {
  try {
    return JSON.parse(await readFile(join(path, '.claude/keel.json'), 'utf8')) as KeelConfiguration
  } catch {
    return {}
  }
}

/** What is true about a remembered path right now, whether or not it is still there. */
async function describe(remembered: RememberedWorkspace): Promise<Workspace> {
  const path = remembered.path
  const unreachable: Workspace = {
    id: remembered.id,
    name: basename(path),
    path,
    reachable: false,
  }

  let entry
  try {
    entry = await stat(path)
  } catch {
    return unreachable
  }
  if (!entry.isDirectory()) return unreachable

  const configuration = await readConfiguration(path)
  const ticketRepository = configuration.ticket_repo
  const tracker = trackerOf(configuration)

  return {
    id: remembered.id,
    name: basename(path),
    path,
    reachable: true,
    ...(ticketRepository !== undefined && { ticketRepository: absolute(ticketRepository) }),
    ...(tracker !== undefined && { tracker }),
  }
}

/** Rejects a path that is not an existing directory, in words for the developer. */
async function requireDirectory(path: string): Promise<void> {
  let entry
  try {
    entry = await stat(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES') throw new NotADirectoryError(`No permission to read ${path}.`)
    throw new NotADirectoryError(`There is nothing at ${path}.`)
  }
  if (!entry.isDirectory()) throw new NotADirectoryError(`${path} is not a directory.`)
}

export const createWorkspaceRegistry: CreateWorkspaceRegistry = async (
  store: WorkspaceStore,
): Promise<WorkspaceRegistry> => {
  let remembered = await store.read()
  let workspaces = await Promise.all(remembered.map(describe))
  let byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))

  function publish(described: Workspace[]): readonly Workspace[] {
    workspaces = described
    byId = new Map(described.map((workspace) => [workspace.id, workspace]))
    return workspaces
  }

  // Mutators share one chain, so a double click cannot read the same list twice
  // and write one of the two additions away.
  let pending: Promise<unknown> = Promise.resolve()
  function serialise<T>(work: () => Promise<T>): Promise<T> {
    const next = pending.then(work, work)
    pending = next.catch(() => undefined)
    return next
  }

  async function reread(): Promise<readonly Workspace[]> {
    return publish(await Promise.all(remembered.map(describe)))
  }

  return {
    list: () => workspaces,
    find: (id: WorkspaceId) => byId.get(id),

    add: (path) =>
      serialise(async () => {
        const target = absolute(path)
        await requireDirectory(target)

        if (remembered.some((entry) => entry.path === target)) return reread()

        remembered = [...remembered, { id: randomUUID(), path: target }]
        await store.write(remembered)
        return reread()
      }),

    remove: (id) =>
      serialise(async () => {
        if (!remembered.some((entry) => entry.id === id)) return reread()

        remembered = remembered.filter((entry) => entry.id !== id)
        await store.write(remembered)
        return reread()
      }),

    refresh: () => serialise(reread),
  }
}
