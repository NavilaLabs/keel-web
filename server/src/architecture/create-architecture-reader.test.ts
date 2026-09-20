import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Workspace } from '../workspaces/types.js'
import { createArchitectureReader } from './create-architecture-reader.js'
import { UnknownArchitectureViewError, UnreadableArchitectureError } from './types.js'

const run = promisify(execFile)

const asIs = `specification {
  element system
}
model {
  keelWeb = system 'keel-web'
}
views {
  view context of keelWeb {
    include *
  }
}
`

const toBe = asIs.replace(
  'view context of keelWeb {\n    include *\n  }',
  'view context of keelWeb {\n    include *\n  }\n\n  view planned of keelWeb {\n    include *\n  }',
)

let repository: string
let workspace: Workspace

async function git(...args: string[]) {
  await run('git', ['-C', repository, ...args])
}

beforeAll(async () => {
  repository = await mkdtemp(join(tmpdir(), 'keel-architecture-'))
  workspace = {
    id: 'w1',
    name: 'keel-web',
    path: repository,
    reachable: true,
    ticketRepository: repository,
  }

  await mkdir(join(repository, 'architecture'), { recursive: true })
  await writeFile(join(repository, 'architecture/model.c4'), asIs)

  await git('init', '--initial-branch=main')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'test')
  await git('add', '-A')
  await git('commit', '-m', 'as-is')

  await git('checkout', '-b', 'ticket/9')
  await writeFile(join(repository, 'architecture/model.c4'), toBe)
  await git('commit', '-am', 'to-be')
  await git('checkout', 'main')
}, 60_000)

afterAll(async () => {
  await rm(repository, { recursive: true, force: true })
})

describe('the architecture reader', () => {
  it('names the views of the branch that is checked out', async () => {
    const reader = createArchitectureReader()

    expect(await reader.views(workspace)).toContain('context')
  }, 30_000)

  it('reads another branch without checking it out', async () => {
    const reader = createArchitectureReader()

    const views = await reader.views(workspace, 'ticket/9')

    expect(views).toContain('planned')
    expect(await reader.views(workspace, 'main')).not.toContain('planned')
  }, 30_000)

  it('lays a view out and says which branch it came from', async () => {
    const reader = createArchitectureReader()

    const answer = await reader.view(workspace, 'context', 'ticket/9')

    expect(answer.branch).toBe('ticket/9')
    expect(answer.etag).toMatch(/^"[0-9a-f]+"$/)
    expect((answer.model as { views: Record<string, unknown> }).views).toHaveProperty('context')
  }, 30_000)

  it('sees an uncommitted edit on the branch that is checked out', async () => {
    const reader = createArchitectureReader()
    const before = await reader.view(workspace, 'context')

    await writeFile(join(repository, 'architecture/model.c4'), toBe)
    const after = await reader.view(workspace, 'context')
    await writeFile(join(repository, 'architecture/model.c4'), asIs)

    expect(after.etag).not.toBe(before.etag)
  }, 30_000)

  it('says which view it does not have', async () => {
    const reader = createArchitectureReader()

    await expect(reader.view(workspace, 'nothing')).rejects.toBeInstanceOf(
      UnknownArchitectureViewError,
    )
  }, 30_000)

  it('refuses a branch it cannot read', async () => {
    const reader = createArchitectureReader()

    await expect(reader.view(workspace, 'context', 'no-such-branch')).rejects.toBeInstanceOf(
      UnreadableArchitectureError,
    )
  }, 30_000)

  it('answers with no views rather than failing the tree when the model is broken', async () => {
    const reader = createArchitectureReader()

    expect(await reader.views(workspace, 'no-such-branch')).toEqual([])
  }, 30_000)

  it('holds no views for a workspace without a ticket repository', async () => {
    const reader = createArchitectureReader()

    expect(await reader.views({ ...workspace, ticketRepository: undefined })).toEqual([])
  })
})
