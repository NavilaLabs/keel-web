import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createWorkspaceRegistry } from './create-workspace-registry.js'
import { createWorkspaceStore } from './create-workspace-store.js'
import { NotADirectoryError, type WorkspaceRegistry } from './types.js'

describe('workspace registry', () => {
  let root: string
  let configuration: string

  async function repository(name: string, keel?: object): Promise<string> {
    const path = join(root, name)
    await mkdir(join(path, '.claude'), { recursive: true })
    if (keel !== undefined) {
      await writeFile(join(path, '.claude/keel.json'), JSON.stringify(keel), 'utf8')
    }
    return path
  }

  function registry(): Promise<WorkspaceRegistry> {
    return createWorkspaceRegistry(createWorkspaceStore({ directory: configuration }))
  }

  /** A registry holding one added repository, which is where most tests start. */
  async function withOne(name: string, keel?: object) {
    const path = await repository(name, keel)
    const known = await registry()
    await known.add(path)
    return { known, path }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workspaces-'))
    configuration = await mkdtemp(join(tmpdir(), 'workspaces-config-'))
  })

  it('starts empty when nothing has been added', async () => {
    expect((await registry()).list()).toEqual([])
  })

  it('names a workspace after its directory', async () => {
    const { known, path } = await withOne('my-project')

    expect(known.list()).toHaveLength(1)
    expect(known.list()[0]).toMatchObject({ name: 'my-project', path, reachable: true })
  })

  it('reads the ticket repository and the tracker from keel.json', async () => {
    const { known } = await withOne('project', {
      ticket_repo: join(root, 'project-tickets'),
      tickets: { source: 'github', repository: 'Org/project' },
    })

    expect(known.list()[0].ticketRepository).toBe(join(root, 'project-tickets'))
    expect(known.list()[0].tracker).toEqual({ source: 'github', repository: 'Org/project' })
  })

  it('lists a repository without keel.json, but without a ticket repository', async () => {
    const { known } = await withOne('plain')

    expect(known.list()[0]).toMatchObject({ name: 'plain', reachable: true })
    expect(known.list()[0].ticketRepository).toBeUndefined()
  })

  it('ignores a tracker it does not know', async () => {
    const { known } = await withOne('project', {
      tickets: { source: 'trac', repository: 'Org/project' },
    })

    expect(known.list()[0].tracker).toBeUndefined()
  })

  it('keeps a workspace id across restarts', async () => {
    const { known } = await withOne('project')
    const before = known.list()[0].id

    expect((await registry()).list()[0].id).toBe(before)
  })

  it('gives different repositories different ids', async () => {
    const known = await registry()
    await known.add(await repository('one'))
    await known.add(await repository('two'))

    expect(new Set(known.list().map((workspace) => workspace.id)).size).toBe(2)
  })

  it('finds a workspace by id and refuses an unknown one', async () => {
    const { known } = await withOne('project')
    const [workspace] = known.list()

    expect(known.find(workspace.id)).toBe(workspace)
    expect(known.find('nope')).toBeUndefined()
  })

  it('refuses a path that is not there', async () => {
    const known = await registry()

    await expect(known.add(join(root, 'missing'))).rejects.toBeInstanceOf(NotADirectoryError)
    expect(known.list()).toEqual([])
  })

  it('refuses a path that is not a directory', async () => {
    const file = join(root, 'a-file')
    await writeFile(file, '', 'utf8')

    await expect((await registry()).add(file)).rejects.toBeInstanceOf(NotADirectoryError)
  })

  it('adds the same path twice as one workspace', async () => {
    const { known, path } = await withOne('project')

    expect(await known.add(path)).toHaveLength(1)
  })

  it('does not lose an entry when two additions overlap', async () => {
    const known = await registry()
    const [one, two] = [await repository('one'), await repository('two')]

    await Promise.all([known.add(one), known.add(two)])

    expect(known.list()).toHaveLength(2)
    expect((await registry()).list()).toHaveLength(2)
  })

  it('lists a workspace whose path has gone, rather than dropping it', async () => {
    const { known, path } = await withOne('project')
    await rm(path, { recursive: true })

    const listed = await known.refresh()

    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ name: 'project', reachable: false })
    expect(listed[0].ticketRepository).toBeUndefined()
  })

  it('starts even when a remembered path has gone', async () => {
    const { path } = await withOne('project')
    await rm(path, { recursive: true })

    expect((await registry()).list()[0]).toMatchObject({ reachable: false })
  })

  it('notices a keel.json written after the workspace was added', async () => {
    const { known, path } = await withOne('project')
    expect(known.list()[0].ticketRepository).toBeUndefined()

    await writeFile(
      join(path, '.claude/keel.json'),
      JSON.stringify({ ticket_repo: join(root, 'tickets') }),
      'utf8',
    )

    expect((await known.refresh())[0].ticketRepository).toBe(join(root, 'tickets'))
  })

  it('forgets a workspace without touching the repository', async () => {
    const { known, path } = await withOne('project')

    expect(await known.remove(known.list()[0].id)).toEqual([])
    expect((await registry()).list()).toEqual([])
    await expect(known.add(path)).resolves.toHaveLength(1)
  })

  it('gives a re-added repository a new identity', async () => {
    const { known, path } = await withOne('project')
    const before = known.list()[0].id

    await known.remove(before)
    await known.add(path)

    expect(known.list()[0].id).not.toBe(before)
  })

  it('shrugs off removing what is already gone', async () => {
    const { known } = await withOne('project')

    await expect(known.remove('nope')).resolves.toHaveLength(1)
  })
})
