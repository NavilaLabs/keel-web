import { useEffect, useState } from 'react'
import type { WorkspaceSummary } from './types.ts'

/**
 * The workspaces the server knows.
 *
 * Read once: adding and removing them is not part of this ticket, so the list
 * only changes when the server restarts.
 */
export function useWorkspaces(): { workspaces: readonly WorkspaceSummary[]; loading: boolean } {
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/workspaces')
      .then((response) => (response.ok ? (response.json() as Promise<WorkspaceSummary[]>) : []))
      .catch(() => [])
      .then((listed) => {
        if (cancelled) return
        setWorkspaces(listed)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { workspaces, loading }
}
