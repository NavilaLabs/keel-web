import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createWorkspaceRegistry } from './create-workspace-registry.js'

describe('workspace registry', () => {
  let root: string

  async function repository(name: string, keel?: object): Promise<string> {
    const path = join(root, name)
    await mkdir(join(path, '.claude'), { recursive: true })
    if (keel !== undefined) {
      await writeFile(join(path, '.claude/keel.json'), JSON.stringify(keel), 'utf8')
    }
    return path
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workspaces-'))
  })

  it('names a workspace after its directory', async () => {
    const path = await repository('my-project')

    const registry = await createWorkspaceRegistry([path])

    expect(registry.list()).toHaveLength(1)
    expect(registry.list()[0]).toMatchObject({ name: 'my-project', path })
  })

  it('reads the ticket repository and the tracker from keel.json', async () => {
    const path = await repository('project', {
      ticket_repo: join(root, 'project-tickets'),
      tickets: { source: 'github', repository: 'Org/project' },
    })

    const [workspace] = (await createWorkspaceRegistry([path])).list()

    expect(workspace.ticketRepository).toBe(join(root, 'project-tickets'))
    expect(workspace.tracker).toEqual({ source: 'github', repository: 'Org/project' })
  })

  it('lists a repository without keel.json, but without a ticket repository', async () => {
    const path = await repository('plain')

    const [workspace] = (await createWorkspaceRegistry([path])).list()

    expect(workspace.name).toBe('plain')
    expect(workspace.ticketRepository).toBeUndefined()
  })

  it('ignores a tracker it does not know', async () => {
    const path = await repository('project', {
      tickets: { source: 'trac', repository: 'Org/project' },
    })

    expect((await createWorkspaceRegistry([path])).list()[0].tracker).toBeUndefined()
  })

  it('gives a workspace the same id every time', async () => {
    const path = await repository('project')

    const first = await createWorkspaceRegistry([path])
    const second = await createWorkspaceRegistry([path])

    expect(first.list()[0].id).toBe(second.list()[0].id)
  })

  it('gives different repositories different ids', async () => {
    const paths = [await repository('one'), await repository('two')]

    const ids = (await createWorkspaceRegistry(paths)).list().map((workspace) => workspace.id)

    expect(new Set(ids).size).toBe(2)
  })

  it('finds a workspace by id and refuses an unknown one', async () => {
    const registry = await createWorkspaceRegistry([await repository('project')])
    const [workspace] = registry.list()

    expect(registry.find(workspace.id)).toBe(workspace)
    expect(registry.find('nope')).toBeUndefined()
  })

  it('refuses to start when a configured path does not exist', async () => {
    await expect(createWorkspaceRegistry([join(root, 'missing')])).rejects.toThrow()
  })

  it('refuses a path that is not a directory', async () => {
    const file = join(root, 'a-file')
    await writeFile(file, '', 'utf8')

    await expect(createWorkspaceRegistry([file])).rejects.toThrow()
  })
})
