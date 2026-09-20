import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDirectoryBrowser } from './create-directory-browser.js'
import { UnreadableDirectoryError } from './types.js'

describe('directory browser', () => {
  let root: string
  const browser = createDirectoryBrowser()

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'directories-'))
  })

  it('lists the home directory when asked for nothing', async () => {
    expect((await browser.list()).path).toBe(homedir())
  })

  it('lists subdirectories and leaves files out', async () => {
    await mkdir(join(root, 'projects'))
    await writeFile(join(root, 'notes.txt'), '', 'utf8')

    const listing = await browser.list(root)

    expect(listing.entries).toEqual([{ name: 'projects', path: join(root, 'projects') }])
  })

  it('carries the absolute path of every entry, so the browser needs no path arithmetic', async () => {
    await mkdir(join(root, 'one'))

    expect((await browser.list(root)).entries[0].path).toBe(join(root, 'one'))
  })

  it('leaves out directories that start with a dot', async () => {
    await mkdir(join(root, '.hidden'))
    await mkdir(join(root, 'shown'))

    expect((await browser.list(root)).entries.map((entry) => entry.name)).toEqual(['shown'])
  })

  it('sorts by name without regard to case', async () => {
    for (const name of ['Zebra', 'apple', 'Banana']) await mkdir(join(root, name))

    expect((await browser.list(root)).entries.map((entry) => entry.name)).toEqual([
      'apple',
      'Banana',
      'Zebra',
    ])
  })

  it('treats a symlink to a directory as a directory', async () => {
    await mkdir(join(root, 'real'))
    await symlink(join(root, 'real'), join(root, 'linked'))

    expect((await browser.list(root)).entries.map((entry) => entry.name)).toEqual([
      'linked',
      'real',
    ])
  })

  it('leaves a symlink to a file out', async () => {
    await writeFile(join(root, 'a-file'), '', 'utf8')
    await symlink(join(root, 'a-file'), join(root, 'linked'))

    expect((await browser.list(root)).entries).toEqual([])
  })

  it('names the directory above, so the dialog can go up', async () => {
    await mkdir(join(root, 'child'))

    expect((await browser.list(join(root, 'child'))).parent).toBe(root)
  })

  it('has no parent at the root of the filesystem', async () => {
    expect((await browser.list('/')).parent).toBeUndefined()
  })

  it('expands a leading tilde', async () => {
    expect((await browser.list('~')).path).toBe(homedir())
  })

  it('refuses a relative path rather than resolving it against the server cwd', async () => {
    await expect(browser.list('projects')).rejects.toBeInstanceOf(UnreadableDirectoryError)
  })

  it('says so when the path is not there', async () => {
    await expect(browser.list(join(root, 'missing'))).rejects.toBeInstanceOf(
      UnreadableDirectoryError,
    )
  })

  it('says so when the path is a file', async () => {
    const file = join(root, 'a-file')
    await writeFile(file, '', 'utf8')

    await expect(browser.list(file)).rejects.toThrow(/not a directory/)
  })
})
