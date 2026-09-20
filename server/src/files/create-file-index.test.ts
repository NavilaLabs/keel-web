import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '../logging/types.js'
import { UnknownWorkspaceError } from '../sessions/types.js'
import type { Workspace, WorkspaceRegistry } from '../workspaces/types.js'
import { createFileIndex } from './create-file-index.js'
import type { FileIndex } from './types.js'

const run = promisify(execFile)

const silentLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => silentLogger,
} as unknown as Logger

async function repositoryWithFiles(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'file-index-'))
  await run('git', ['init', '--quiet'], { cwd: path })
  await mkdir(join(path, 'client', 'src'), { recursive: true })
  await mkdir(join(path, 'node_modules'), { recursive: true })

  await writeFile(join(path, 'README.md'), 'read me')
  await writeFile(join(path, '.gitignore'), 'node_modules\nsecret.txt\n')
  await writeFile(join(path, 'client', 'src', 'chat.tsx'), 'chat')
  await writeFile(join(path, 'secret.txt'), 'not for the popup')
  await writeFile(join(path, 'node_modules', 'library.js'), 'library')

  await run('git', ['add', 'README.md'], { cwd: path })
  return path
}

describe('file index', () => {
  let repository: string
  let bare: string
  let workspaces: WorkspaceRegistry
  let files: FileIndex

  beforeEach(async () => {
    repository = await repositoryWithFiles()
    bare = await mkdtemp(join(tmpdir(), 'file-index-bare-'))
    const known: Workspace[] = [
      { id: 'w1', name: 'one', path: repository, ticketRepository: '/tickets' },
      { id: 'bare', name: 'bare', path: bare },
    ]
    workspaces = {
      list: () => known,
      find: (id) => known.find((workspace) => workspace.id === id),
    }
    files = createFileIndex({ workspaces, logger: silentLogger })
  })

  it('offers the tracked files and the untracked ones no rule ignores', async () => {
    const found = await files.matches('w1', '', 50)
    const paths = found.entries.map((entry) => entry.path)

    expect(paths).toContain('README.md')
    expect(paths).toContain('client/src/chat.tsx')
    expect(found.reason).toBeUndefined()
  })

  it('leaves out what the ignore rules cover', async () => {
    const paths = (await files.matches('w1', '', 50)).entries.map((entry) => entry.path)

    expect(paths).not.toContain('secret.txt')
    expect(paths.some((path) => path.startsWith('node_modules'))).toBe(false)
  })

  it('offers the directories the files lie in', async () => {
    const found = await files.matches('w1', 'client', 50)

    expect(found.entries).toContainEqual({ path: 'client', kind: 'directory' })
    expect(found.entries).toContainEqual({ path: 'client/src', kind: 'directory' })
  })

  it('says why a workspace with no git repository has nothing to complete', async () => {
    const found = await files.matches('bare', '', 50)

    expect(found.entries).toEqual([])
    expect(found.reason).toMatch(/not a git repository/)
  })

  it('builds once however many callers arrive together', async () => {
    const [first, second] = await Promise.all([
      files.matches('w1', 'readme', 10),
      files.matches('w1', 'readme', 10),
    ])

    expect(first.entries).toEqual(second.entries)
  })

  it('refuses a workspace that is not registered', async () => {
    await expect(files.matches('gone', '', 10)).rejects.toBeInstanceOf(UnknownWorkspaceError)
  })

  it('finds a file the agent wrote once the index is no longer fresh', async () => {
    const eager = createFileIndex({ workspaces, logger: silentLogger, freshForMs: 0 })
    await eager.matches('w1', '', 50)

    await writeFile(join(repository, 'client', 'src', 'later.tsx'), 'later')

    // Each ask answers from what is held and rebuilds behind that answer, so
    // the file arrives on a later ask rather than on the one that triggered
    // the rebuild.
    await vi.waitFor(async () => {
      const found = await eager.matches('w1', 'later', 10)
      expect(found.entries.map((entry) => entry.path)).toContain('client/src/later.tsx')
    })
  })
})
