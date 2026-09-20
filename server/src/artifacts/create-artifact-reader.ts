import { createHash } from 'node:crypto'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ArtifactContent, ArtifactNode, StubFingerprint, TicketId } from '@keel-web/protocol'
import type { Workspace } from '../workspaces/types.js'
import {
  ArtifactOutsideWorkspaceError,
  UnreadableArtifactError,
  type ArtifactReader,
  type CreateArtifactReader,
} from './types.js'

/** A ticket id becomes a path segment, so it may only be one. */
const safeSegment = /^[A-Za-z0-9._-]+$/

/** Written by keel or by keel-web rather than for the developer, and listed last. */
const workflowFiles = ['state.json', 'events.jsonl', '.state-snapshot.json', 'transcript.jsonl']

interface ClaimedStub {
  path: string
  symbol?: string
  fingerprint?: string
}

interface TicketBlock {
  id: string
  title?: string
  claimed_stubs?: ClaimedStub[]
}

interface TicketState {
  to_be_branch?: string
  artifacts?: {
    knowledge?: string
    adrs?: string[]
  }
  blocks?: TicketBlock[]
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * The path, resolved, proven to be inside the root and canonical.
 *
 * Canonical matters: a symlink inside the repository can point anywhere, and
 * comparing the path as it was written would follow it without noticing. The
 * check therefore happens on what the filesystem says the path really is.
 *
 * A path that does not exist cannot be canonicalised, so the containment of
 * its directory is checked instead and the missing file is reported by the
 * read that follows.
 */
function inside(candidate: string, within: string): boolean {
  const step = relative(within, candidate)
  return step !== '' && !step.startsWith(`..${sep}`) && step !== '..' && !isAbsolute(step)
}

async function bounded(root: string, path: string): Promise<string> {
  const target = resolve(root, path)

  const canonicalRoot = await realpath(root).catch(() => {
    throw new UnreadableArtifactError(`There is no repository at ${root}.`)
  })

  let canonical: string
  try {
    canonical = await realpath(target)
  } catch {
    canonical = resolve(canonicalRoot, path)
  }

  if (!inside(canonical, canonicalRoot)) {
    throw new ArtifactOutsideWorkspaceError(`${path} lies outside the repository it was read from.`)
  }
  return canonical
}

function ticketRepositoryOf(workspace: Workspace): string {
  if (!workspace.ticketRepository) {
    throw new UnreadableArtifactError(
      `${workspace.name} has no ticket repository, so it holds no artefacts.`,
    )
  }
  return workspace.ticketRepository
}

function ticketDirectory(ticketId: TicketId): string {
  if (!safeSegment.test(ticketId)) {
    throw new UnreadableArtifactError(`${ticketId} is not a ticket id.`)
  }
  return join('tickets', ticketId)
}

async function readState(repository: string, ticketId: TicketId): Promise<TicketState> {
  try {
    const path = join(repository, ticketDirectory(ticketId), 'state.json')
    return JSON.parse(await readFile(path, 'utf8')) as TicketState
  } catch {
    return {}
  }
}

/** The first heading of a Markdown file, which is what the document calls itself. */
async function headingOf(path: string, fallback: string): Promise<string> {
  try {
    const content = await readFile(path, 'utf8')
    const heading = content.split('\n').find((line) => line.startsWith('# '))
    return heading ? heading.slice(2).trim() : fallback
  } catch {
    return fallback
  }
}

async function entriesOf(path: string): Promise<{ files: string[]; directories: string[] }> {
  try {
    const found = await readdir(path, { withFileTypes: true })
    return {
      files: found.filter((entry) => entry.isFile()).map((entry) => entry.name),
      directories: found.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    }
  } catch {
    return { files: [], directories: [] }
  }
}

function byName(one: string, other: string): number {
  return one.localeCompare(other, undefined, { numeric: true })
}

function group(label: string, children: ArtifactNode[]): ArtifactNode[] {
  return children.length === 0 ? [] : [{ type: 'group', label, children }]
}

export const createArtifactReader: CreateArtifactReader = ({ architecture }): ArtifactReader => ({
  async tree(workspace, ticketId) {
    let repository: string
    try {
      repository = ticketRepositoryOf(workspace)
    } catch (error) {
      return { ticketId, nodes: [], reason: (error as Error).message }
    }

    const directory = ticketDirectory(ticketId)
    const absolute = join(repository, directory)
    const state = await readState(repository, ticketId)
    const { files } = await entriesOf(absolute)

    if (files.length === 0) {
      return {
        ticketId,
        nodes: [],
        reason: `keel has not worked ticket ${ticketId} in this repository yet.`,
      }
    }

    const named = new Set(state.artifacts?.adrs ?? [])
    const nodes: ArtifactNode[] = []

    const ticketFiles: ArtifactNode[] = []
    for (const file of files.filter((name) => !workflowFiles.includes(name)).sort(byName)) {
      const path = join(directory, file)
      const markdown = file.endsWith('.md')
      ticketFiles.push({
        type: 'artifact',
        label: markdown ? await headingOf(join(repository, path), file) : file,
        ref: {
          kind: file === 'knowledge.md' ? 'knowledge' : markdown ? 'document' : 'file',
          repository: 'ticket',
          path,
        },
        named: file === 'knowledge.md' && state.artifacts?.knowledge !== undefined,
      })
    }
    nodes.push(...group('Ticket', ticketFiles))

    const decisions = await entriesOf(join(absolute, 'adr'))
    const ownAdrs = decisions.files
      .filter((file) => file.endsWith('.md'))
      .map((file) => join(directory, 'adr', file))
    const foreignAdrs = [...named].filter((path) => !ownAdrs.includes(path))
    const adrNodes: ArtifactNode[] = []
    for (const path of [...ownAdrs.sort(byName), ...foreignAdrs.sort(byName)]) {
      adrNodes.push({
        type: 'artifact',
        label: await headingOf(join(repository, path), basename(path)),
        ref: { kind: 'adr', repository: 'ticket', path },
        named: named.has(path),
      })
    }
    nodes.push(...group('Decisions', adrNodes))

    const contracts: ArtifactNode[] = []
    for (const block of state.blocks ?? []) {
      const stubs = (block.claimed_stubs ?? []).map(
        (stub): ArtifactNode => ({
          type: 'artifact',
          label: stub.symbol ?? basename(stub.path),
          ref: {
            kind: 'stub',
            repository: 'code',
            path: stub.path,
            ...(stub.symbol && { symbol: stub.symbol }),
          },
          named: true,
        }),
      )
      contracts.push(...group(block.title ? `${block.id} ${block.title}` : block.id, stubs))
    }
    nodes.push(...group('Contracts', contracts))

    const views = await architecture.views(workspace, state.to_be_branch)
    const sources = await entriesOf(join(repository, 'architecture'))
    const architectureNodes: ArtifactNode[] = views.map((view) => ({
      type: 'artifact',
      label: view,
      ref: { kind: 'c4View', view, ...(state.to_be_branch && { branch: state.to_be_branch }) },
      named: true,
    }))
    architectureNodes.push(
      ...group(
        'Sources',
        sources.files
          .filter((file) => file.endsWith('.c4'))
          .sort(byName)
          .map((file) => ({
            type: 'artifact',
            label: file,
            ref: { kind: 'c4Source', repository: 'ticket', path: join('architecture', file) },
            named: false,
          })),
      ),
    )
    nodes.push(...group('Architecture', architectureNodes))

    const workflow = workflowFiles
      .filter((file) => files.includes(file))
      .map(
        (file): ArtifactNode => ({
          type: 'artifact',
          label: file,
          ref: { kind: 'file', repository: 'ticket', path: join(directory, file) },
          named: false,
        }),
      )
    nodes.push(...group('Workflow', workflow))

    return { ticketId, nodes }
  },

  async read(workspace, ticketId, ref) {
    if (ref.kind === 'c4View') {
      throw new UnreadableArtifactError(
        `${ref.view} is a view of the architecture model, not a file.`,
      )
    }

    const root = ref.repository === 'ticket' ? ticketRepositoryOf(workspace) : workspace.path
    const path = await bounded(root, ref.path)

    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EACCES') {
        throw new UnreadableArtifactError(`No permission to read ${ref.path}.`)
      }
      if (code === 'EISDIR') {
        throw new UnreadableArtifactError(`${ref.path} is a directory.`)
      }
      throw new UnreadableArtifactError(`There is nothing at ${ref.path}.`)
    }

    const current = digest(text)
    const content: ArtifactContent = { ref, text, etag: `"${current}"` }

    if (ref.kind !== 'stub') return content

    const state = await readState(ticketRepositoryOf(workspace), ticketId)
    const frozen = (state.blocks ?? [])
      .flatMap((block) => block.claimed_stubs ?? [])
      .find((stub) => stub.path === ref.path)?.fingerprint
    if (frozen === undefined) return content

    const fingerprint: StubFingerprint = { frozen, current, matches: frozen === current }
    return { ...content, fingerprint }
  },
})
