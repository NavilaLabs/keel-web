import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import {
  UnreadableStoreError,
  type CreateWorkspaceStore,
  type RememberedWorkspace,
  type WorkspaceStore,
} from './types.js'

/**
 * The specification treats an unset, empty or relative `XDG_CONFIG_HOME` the
 * same way, so all three land on the default rather than being resolved.
 */
function configurationDirectory(): string {
  const configured = process.env.XDG_CONFIG_HOME
  const base =
    configured !== undefined && configured !== '' && isAbsolute(configured)
      ? configured
      : join(homedir(), '.config')
  return join(base, 'keel-web')
}

function rememberedOf(value: unknown): RememberedWorkspace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { id, path } = value as Record<string, unknown>
  if (typeof id !== 'string' || typeof path !== 'string') return undefined
  return { id, path }
}

export const createWorkspaceStore: CreateWorkspaceStore = (options = {}): WorkspaceStore => {
  const directory = options.directory ?? configurationDirectory()
  const file = join(directory, 'workspaces.json')

  // One chain for the whole file, so two additions cannot both read the old
  // list and write over each other.
  let pending: Promise<unknown> = Promise.resolve()
  function serialise<T>(work: () => Promise<T>): Promise<T> {
    const next = pending.then(work, work)
    pending = next.catch(() => undefined)
    return next
  }

  return {
    read: () =>
      serialise(async () => {
        let content: string
        try {
          content = await readFile(file, 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
          throw new UnreadableStoreError(`Cannot read ${file}: ${(error as Error).message}`)
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(content)
        } catch (error) {
          throw new UnreadableStoreError(
            `${file} is not valid JSON: ${(error as Error).message}. ` +
              'It holds the repositories you added, so keel-web will not overwrite it.',
          )
        }

        if (!Array.isArray(parsed)) {
          throw new UnreadableStoreError(`${file} should hold a list of workspaces.`)
        }
        return parsed.map(rememberedOf).filter((entry) => entry !== undefined)
      }),

    write: (workspaces) =>
      serialise(async () => {
        await mkdir(directory, { recursive: true })
        // Same directory, so the rename stays within one filesystem and a
        // reader never sees half a list.
        const temporary = join(directory, `.workspaces.${randomUUID()}.json`)
        await writeFile(temporary, `${JSON.stringify(workspaces, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
          flush: true,
        })
        await rename(temporary, file)
      }),
  }
}
