import { useCallback, useState } from 'react'
import type { DirectoryListing } from '@keel-web/protocol'
import type { Directories, UseDirectories } from './types.ts'

export const useDirectories: UseDirectories = (): Directories => {
  const [listing, setListing] = useState<DirectoryListing>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const go = useCallback(async (path?: string) => {
    setLoading(true)
    setError(undefined)
    try {
      const query = path === undefined ? '' : `?path=${encodeURIComponent(path)}`
      const response = await fetch(`/api/directories${query}`)
      if (!response.ok) {
        const body = (await response.json().catch(() => undefined)) as
          | { reason?: string }
          | undefined
        // The last good listing stays, so a mistyped path does not empty the dialog.
        setError(body?.reason ?? 'That directory could not be read.')
        return
      }
      setListing((await response.json()) as DirectoryListing)
    } catch {
      setError('The server did not answer.')
    } finally {
      setLoading(false)
    }
  }, [])

  return { listing, loading, error, go }
}
