import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactNode } from '@keel-web/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Workspace } from '../workspaces/types.js'
import { createArtifactReader } from './create-artifact-reader.js'
import { ArtifactOutsideWorkspaceError, UnreadableArtifactError } from './types.js'

const noViews = { views: async () => [] }

let ticketRepository: string
let codeRepository: string
let workspace: Workspace

const stubSource = 'export interface ArtifactReader {}\n'
const frozen = createHash('sha256').update(stubSource).digest('hex')

function labelsOf(nodes: readonly ArtifactNode[], label: string): string[] {
  const found = nodes.find((node) => node.type === 'group' && node.label === label)
  if (!found || found.type !== 'group') return []
  return found.children.map((child) => child.label)
}

beforeEach(async () => {
  ticketRepository = await mkdtemp(join(tmpdir(), 'keel-tickets-'))
  codeRepository = await mkdtemp(join(tmpdir(), 'keel-code-'))
  workspace = {
    id: 'w1',
    name: 'keel-web',
    path: codeRepository,
    reachable: true,
    ticketRepository,
  }

  await mkdir(join(ticketRepository, 'tickets/9/adr'), { recursive: true })
  await mkdir(join(ticketRepository, 'architecture'), { recursive: true })
  await mkdir(join(ticketRepository, 'tickets/1/adr'), { recursive: true })
  await mkdir(join(codeRepository, 'server/src/artifacts'), { recursive: true })

  await writeFile(join(ticketRepository, 'tickets/9/knowledge.md'), '# 9: The artefact centre\n')
  await writeFile(
    join(ticketRepository, 'tickets/9/adr/0015-a-host-guard.md'),
    '# 0015. A host guard in front of every route\n',
  )
  await writeFile(
    join(ticketRepository, 'tickets/1/adr/0002-containers.md'),
    '# 0002. Containers\n',
  )
  await writeFile(join(ticketRepository, 'tickets/9/notes-for-me.txt'), 'left here on purpose\n')
  await writeFile(join(ticketRepository, 'tickets/9/events.jsonl'), '{}\n')
  await writeFile(join(ticketRepository, 'tickets/9/.state-snapshot.json'), '{}\n')
  await writeFile(join(ticketRepository, 'architecture/container-server.c4'), 'model {}\n')
  await writeFile(join(codeRepository, 'server/src/artifacts/types.ts'), stubSource)
  await writeFile(
    join(ticketRepository, 'tickets/9/state.json'),
    JSON.stringify({
      to_be_branch: 'ticket/9',
      artifacts: {
        knowledge: 'tickets/9/knowledge.md',
        adrs: ['tickets/9/adr/0015-a-host-guard.md', 'tickets/1/adr/0002-containers.md'],
      },
      blocks: [
        {
          id: 'b1',
          title: 'Artefacts served',
          claimed_stubs: [
            {
              path: 'server/src/artifacts/types.ts',
              symbol: 'ArtifactReader',
              fingerprint: frozen,
            },
          ],
        },
      ],
    }),
  )
})

afterEach(async () => {
  await rm(ticketRepository, { recursive: true, force: true })
  await rm(codeRepository, { recursive: true, force: true })
})

describe('the artefact tree', () => {
  it('offers a file nobody recognises, beside the knowledge', async () => {
    const reader = createArtifactReader({ architecture: noViews })

    const tree = await reader.tree(workspace, '9')

    expect(labelsOf(tree.nodes, 'Ticket')).toEqual(['9: The artefact centre', 'notes-for-me.txt'])
  })

  it('labels a decision with its heading and keeps one from another ticket', async () => {
    const reader = createArtifactReader({ architecture: noViews })

    const tree = await reader.tree(workspace, '9')

    expect(labelsOf(tree.nodes, 'Decisions')).toEqual([
      '0015. A host guard in front of every route',
      '0002. Containers',
    ])
  })

  it('groups the contracts by block and labels them with the symbol', async () => {
    const reader = createArtifactReader({ architecture: noViews })

    const tree = await reader.tree(workspace, '9')
    const contracts = tree.nodes.find((node) => node.type === 'group' && node.label === 'Contracts')

    expect(contracts?.type === 'group' && contracts.children[0]).toMatchObject({
      type: 'group',
      label: 'b1 Artefacts served',
      children: [{ label: 'ArtifactReader', named: true }],
    })
  })

  it('names the views of the ticket branch and keeps the sources below them', async () => {
    const reader = createArtifactReader({
      architecture: { views: async () => ['context', 'server'] },
    })

    const tree = await reader.tree(workspace, '9')

    expect(labelsOf(tree.nodes, 'Architecture')).toEqual(['context', 'server', 'Sources'])
  })

  it('keeps the working files, unemphasised and last', async () => {
    const reader = createArtifactReader({ architecture: noViews })

    const tree = await reader.tree(workspace, '9')

    expect(tree.nodes.at(-1)).toMatchObject({ type: 'group', label: 'Workflow' })
    expect(labelsOf(tree.nodes, 'Workflow')).toEqual([
      'state.json',
      'events.jsonl',
      '.state-snapshot.json',
    ])
  })

  it('explains an empty tree rather than pretending the ticket has nothing', async () => {
    const reader = createArtifactReader({ architecture: noViews })

    const tree = await reader.tree(workspace, '404')

    expect(tree.nodes).toEqual([])
    expect(tree.reason).toBe('keel has not worked ticket 404 in this repository yet.')
  })

  it('says so when the workspace has no ticket repository', async () => {
    const reader = createArtifactReader({ architecture: noViews })

    const tree = await reader.tree({ ...workspace, ticketRepository: undefined }, '9')

    expect(tree.reason).toBe('keel-web has no ticket repository, so it holds no artefacts.')
  })
})

describe('reading one artefact', () => {
  it('reads a document and tags it by its content', async () => {
    const reader = createArtifactReader({ architecture: noViews })

    const content = await reader.read(workspace, '9', {
      kind: 'knowledge',
      repository: 'ticket',
      path: 'tickets/9/knowledge.md',
    })

    expect(content.text).toBe('# 9: The artefact centre\n')
    expect(content.etag).toMatch(/^"[0-9a-f]{64}"$/)
  })

  it('reports a stub that still matches what was frozen', async () => {
    const reader = createArtifactReader({ architecture: noViews })

    const content = await reader.read(workspace, '9', {
      kind: 'stub',
      repository: 'code',
      path: 'server/src/artifacts/types.ts',
      symbol: 'ArtifactReader',
    })

    expect(content.fingerprint).toEqual({ frozen, current: frozen, matches: true })
  })

  it('reports the drift once the file has grown an implementation', async () => {
    await writeFile(
      join(codeRepository, 'server/src/artifacts/types.ts'),
      `${stubSource}export const reader = {}\n`,
    )
    const reader = createArtifactReader({ architecture: noViews })

    const content = await reader.read(workspace, '9', {
      kind: 'stub',
      repository: 'code',
      path: 'server/src/artifacts/types.ts',
    })

    expect(content.fingerprint?.matches).toBe(false)
    expect(content.fingerprint?.frozen).toBe(frozen)
  })

  it('refuses a path that climbs out of the repository', async () => {
    const reader = createArtifactReader({ architecture: noViews })

    await expect(
      reader.read(workspace, '9', {
        kind: 'file',
        repository: 'ticket',
        path: '../../etc/passwd',
      }),
    ).rejects.toBeInstanceOf(ArtifactOutsideWorkspaceError)
  })

  it('refuses a symlink pointing out of the repository, rather than following it', async () => {
    await symlink('/etc/passwd', join(ticketRepository, 'tickets/9/escape.md'))
    const reader = createArtifactReader({ architecture: noViews })

    await expect(
      reader.read(workspace, '9', {
        kind: 'document',
        repository: 'ticket',
        path: 'tickets/9/escape.md',
      }),
    ).rejects.toBeInstanceOf(ArtifactOutsideWorkspaceError)
  })

  it('says what is missing when the artefact is not there', async () => {
    const reader = createArtifactReader({ architecture: noViews })

    await expect(
      reader.read(workspace, '9', {
        kind: 'document',
        repository: 'ticket',
        path: 'tickets/9/gone.md',
      }),
    ).rejects.toThrow('There is nothing at tickets/9/gone.md.')
  })

  it('refuses a view, which is not a file', async () => {
    const reader = createArtifactReader({ architecture: noViews })

    await expect(
      reader.read(workspace, '9', { kind: 'c4View', view: 'server', branch: 'ticket/9' }),
    ).rejects.toBeInstanceOf(UnreadableArtifactError)
  })
})
