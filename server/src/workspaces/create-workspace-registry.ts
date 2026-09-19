import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { WorkspaceId } from '@keel-web/protocol'
import type {
  CreateWorkspaceRegistry,
  Workspace,
  WorkspaceRegistry,
  WorkspaceTracker,
} from './types.js'

interface KeelConfiguration {
  ticket_repo?: string
  tickets?: { source?: string; repository?: string }
}

/** Stable across restarts and across a rename, unlike the directory name. */
function identify(path: string): WorkspaceId {
  return createHash('sha256').update(path).digest('hex').slice(0, 12)
}

function trackerOf(configuration: KeelConfiguration): WorkspaceTracker | undefined {
  const { source, repository } = configuration.tickets ?? {}
  if (repository === undefined) return undefined
  if (source !== 'github' && source !== 'jira') return undefined
  return { source, repository }
}

function expand(path: string, home: string | undefined): string {
  if (!path.startsWith('~/') || home === undefined) return path
  return join(home, path.slice(2))
}

async function readConfiguration(path: string): Promise<KeelConfiguration> {
  try {
    return JSON.parse(await readFile(join(path, '.claude/keel.json'), 'utf8')) as KeelConfiguration
  } catch {
    return {}
  }
}

async function describe(path: string, home: string | undefined): Promise<Workspace> {
  const absolute = resolve(path)
  const entry = await stat(absolute)
  if (!entry.isDirectory()) throw new Error(`Not a directory: ${absolute}`)

  const configuration = await readConfiguration(absolute)
  const ticketRepository = configuration.ticket_repo
  const tracker = trackerOf(configuration)

  return {
    id: identify(absolute),
    name: basename(absolute),
    path: absolute,
    ...(ticketRepository !== undefined && {
      ticketRepository: resolve(expand(ticketRepository, home)),
    }),
    ...(tracker !== undefined && { tracker }),
  }
}

export const createWorkspaceRegistry: CreateWorkspaceRegistry = async (
  paths: readonly string[],
): Promise<WorkspaceRegistry> => {
  const home = process.env.HOME
  const workspaces = await Promise.all(paths.map((path) => describe(expand(path, home), home)))
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))

  return {
    list: () => workspaces,
    find: (id) => byId.get(id),
  }
}
