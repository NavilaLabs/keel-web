import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { DirectoryListing } from '@keel-web/protocol'
import type { LoggerVariables } from '../logging/types.js'
import { createDirectoryRoutes } from './create-directory-routes.js'
import { UnreadableDirectoryError, type DirectoryBrowser } from './types.js'

const listing: DirectoryListing = {
  path: '/home/dev',
  parent: '/home',
  entries: [{ name: 'projects', path: '/home/dev/projects' }],
}

function appWith(directories: DirectoryBrowser) {
  const app = new Hono<{ Variables: LoggerVariables }>()
  app.route('/api', createDirectoryRoutes({ directories }))
  return app
}

describe('directory routes', () => {
  it('answers with the home directory when no path is given', async () => {
    const directories = { list: vi.fn(async () => listing) }

    const response = await appWith(directories).request('/api/directories')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(listing)
    expect(directories.list).toHaveBeenCalledWith(undefined)
  })

  it('passes the path through as it was given', async () => {
    const directories = { list: vi.fn(async () => listing) }

    await appWith(directories).request('/api/directories?path=%2Fhome%2Fdev%2Fprojects')

    expect(directories.list).toHaveBeenCalledWith('/home/dev/projects')
  })

  it('passes on the reason a path could not be read', async () => {
    const directories = {
      list: vi.fn(() =>
        Promise.reject(new UnreadableDirectoryError('No permission to read /root.')),
      ),
    }

    const response = await appWith(directories).request('/api/directories?path=%2Froot')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ reason: 'No permission to read /root.' })
  })
})
