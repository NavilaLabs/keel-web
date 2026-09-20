import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type { ArchitectureView } from '@keel-web/protocol'
import type { Workspace } from '../workspaces/types.js'
import {
  UnknownArchitectureViewError,
  UnreadableArchitectureError,
  type ArchitectureReader,
  type CreateArchitectureReader,
} from './types.js'

const run = promisify(execFile)

/** Where the model lives inside the ticket repository. */
const sourceDirectory = 'architecture'

interface Sources {
  files: { name: string; text: string }[]
  /** What the sources were read from, which is what an entity tag is built on. */
  revision: string
}

async function git(repository: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', repository, ...args], { maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (error) {
    throw new UnreadableArchitectureError((error as Error).message.trim())
  }
}

async function currentBranch(repository: string): Promise<string> {
  return (await git(repository, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

/**
 * The model's sources, from the working tree or from a branch.
 *
 * The working tree is read when the branch asked for is the one checked out,
 * because that is what the developer sees, uncommitted edits included. Any
 * other branch is read at its ref, which covers unpushed commits too.
 */
async function sourcesOf(repository: string, branch: string): Promise<Sources> {
  const checkedOut = await currentBranch(repository)

  if (branch === checkedOut) {
    const listing = await git(repository, ['ls-files', '--', sourceDirectory])
    const names = listing
      .split('\n')
      .filter((name) => name.endsWith('.c4'))
      .map((name) => basename(name))
    const files = await Promise.all(
      names.map(async (name) => ({
        name,
        text: await readWorkingFile(repository, name),
      })),
    )
    const revision = createHash('sha256')
      .update(files.map((file) => `${file.name}\u0000${file.text}`).join('\u0000'))
      .digest('hex')
    return { files, revision }
  }

  const listing = await git(repository, [
    'ls-tree',
    '-r',
    '--name-only',
    branch,
    '--',
    sourceDirectory,
  ])
  const paths = listing.split('\n').filter((path) => path.endsWith('.c4'))
  const files = await Promise.all(
    paths.map(async (path) => ({
      name: basename(path),
      text: await git(repository, ['show', `${branch}:${path}`]),
    })),
  )
  const revision = (await git(repository, ['rev-parse', branch])).trim()
  return { files, revision }
}

async function readWorkingFile(repository: string, name: string): Promise<string> {
  try {
    return await readFile(join(repository, sourceDirectory, name), 'utf8')
  } catch {
    return ''
  }
}

function ticketRepositoryOf(workspace: Workspace): string {
  if (!workspace.ticketRepository) {
    throw new UnreadableArchitectureError(
      `${workspace.name} has no ticket repository, so it holds no architecture model.`,
    )
  }
  return workspace.ticketRepository
}

/**
 * Parses the sources in a directory of their own.
 *
 * likec4 reads a workspace from disk, and the sources of another branch exist
 * nowhere on disk, so they are written out and thrown away again. The
 * directory is removed even when parsing fails, because a temporary directory
 * that survives an error is a leak that only shows up later.
 */
async function layout(sources: Sources): Promise<unknown> {
  if (sources.files.length === 0) {
    throw new UnreadableArchitectureError('That branch holds no architecture sources.')
  }

  const directory = await mkdtemp(join(tmpdir(), 'keel-web-architecture-'))
  try {
    await Promise.all(
      sources.files.map((file) => writeFile(join(directory, file.name), file.text, 'utf8')),
    )

    const { LikeC4 } = await import('likec4')
    const likec4 = await LikeC4.fromWorkspace(directory, { graphviz: 'wasm', logger: false })

    const errors = likec4.getErrors()
    if (errors.length > 0) {
      throw new UnreadableArchitectureError(
        `The architecture model does not parse: ${errors[0]?.message ?? 'unknown error'}`,
      )
    }

    const layouted = await likec4.layoutedModel()
    return layouted.$data
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export const createArchitectureReader: CreateArchitectureReader = (): ArchitectureReader => {
  // One model per revision. Parsing and layout cost a few hundred
  // milliseconds, and the same revision is asked for again on every tab
  // change, every reconnect and every conditional read.
  const cache = new Map<string, { data: unknown; views: string[] }>()

  async function modelOf(workspace: Workspace, branch?: string) {
    const repository = ticketRepositoryOf(workspace)
    const wanted = branch ?? (await currentBranch(repository))
    const sources = await sourcesOf(repository, wanted)

    const key = `${repository}\u0000${sources.revision}`
    const held = cache.get(key)
    if (held) return { ...held, branch: wanted, revision: sources.revision }

    const data = await layout(sources)
    const views = Object.keys((data as { views?: Record<string, unknown> }).views ?? {})
    cache.set(key, { data, views })
    return { data, views, branch: wanted, revision: sources.revision }
  }

  return {
    async views(workspace, branch) {
      try {
        return (await modelOf(workspace, branch)).views
      } catch {
        // A model that does not parse, or a branch that is gone, must not take
        // the rest of the artefact tree down with it.
        return []
      }
    },

    async view(workspace, view, branch) {
      const model = await modelOf(workspace, branch)
      if (!model.views.includes(view)) {
        throw new UnknownArchitectureViewError(
          `The model on ${model.branch} has no view called ${view}.`,
        )
      }

      const answer: ArchitectureView = {
        view,
        branch: model.branch,
        model: model.data,
        etag: `"${model.revision}"`,
      }
      return answer
    },
  }
}
