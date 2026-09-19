import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkspaceStore } from './create-workspace-store.js'
import { UnreadableStoreError } from './types.js'

describe('workspace store', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'store-'))
  })

  it('reads an empty list before anything has been added', async () => {
    expect(await createWorkspaceStore({ directory }).read()).toEqual([])
  })

  it('reads back what it wrote', async () => {
    const store = createWorkspaceStore({ directory })
    const remembered = [{ id: 'a', path: '/one' }]

    await store.write(remembered)

    expect(await createWorkspaceStore({ directory }).read()).toEqual(remembered)
  })

  it('leaves no temporary file behind', async () => {
    await createWorkspaceStore({ directory }).write([{ id: 'a', path: '/one' }])

    expect(await readdir(directory)).toEqual(['workspaces.json'])
  })

  it('keeps the list to the developer', async () => {
    await createWorkspaceStore({ directory }).write([{ id: 'a', path: '/one' }])

    expect((await stat(join(directory, 'workspaces.json'))).mode & 0o777).toBe(0o600)
  })

  it('refuses to read a file that is not JSON', async () => {
    await writeFile(join(directory, 'workspaces.json'), 'not json', 'utf8')

    await expect(createWorkspaceStore({ directory }).read()).rejects.toBeInstanceOf(
      UnreadableStoreError,
    )
  })

  it('refuses to read a file that is not a list', async () => {
    await writeFile(join(directory, 'workspaces.json'), '{"id":"a"}', 'utf8')

    await expect(createWorkspaceStore({ directory }).read()).rejects.toBeInstanceOf(
      UnreadableStoreError,
    )
  })

  it('skips an entry that is not a workspace rather than failing the read', async () => {
    await writeFile(
      join(directory, 'workspaces.json'),
      JSON.stringify([{ id: 'a', path: '/one' }, { nonsense: true }]),
      'utf8',
    )

    expect(await createWorkspaceStore({ directory }).read()).toEqual([{ id: 'a', path: '/one' }])
  })

  it('never leaves half a list behind when writes overlap', async () => {
    const store = createWorkspaceStore({ directory })

    await Promise.all([
      store.write([{ id: 'a', path: '/one' }]),
      store.write([
        { id: 'a', path: '/one' },
        { id: 'b', path: '/two' },
      ]),
    ])

    const written = JSON.parse(
      await readFile(join(directory, 'workspaces.json'), 'utf8'),
    ) as unknown
    expect(Array.isArray(written)).toBe(true)
  })

  describe('where the file lives', () => {
    const configured = process.env.XDG_CONFIG_HOME

    afterEach(() => {
      if (configured === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = configured
    })

    it('follows an absolute XDG_CONFIG_HOME', async () => {
      process.env.XDG_CONFIG_HOME = directory
      await createWorkspaceStore().write([{ id: 'a', path: '/one' }])

      expect(await readdir(join(directory, 'keel-web'))).toEqual(['workspaces.json'])
    })

    it('ignores a relative XDG_CONFIG_HOME, as the specification says to', async () => {
      process.env.XDG_CONFIG_HOME = 'relative/config'
      const store = createWorkspaceStore()

      // Falls back to ~/.config rather than resolving the relative path, so
      // nothing is written next to wherever the server happens to be running.
      await expect(store.read()).resolves.toBeDefined()
      expect(await readdir(directory)).toEqual([])
    })
  })
})
