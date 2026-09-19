import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceSummary } from '@keel-web/protocol'
import type { UseWorkspaces, Workspaces } from './types.ts'

/** A failed call says why, in the sentence the server wrote for the developer. */
async function listOrReason(request: Promise<Response>): Promise<readonly WorkspaceSummary[]> {
  const response = await request
  if (response.ok) return (await response.json()) as WorkspaceSummary[]

  const body = (await response.json().catch(() => undefined)) as { reason?: string } | undefined
  throw new Error(body?.reason ?? 'The server would not take that.')
}

export const useWorkspaces: UseWorkspaces = (): Workspaces => {
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    void listOrReason(fetch('/api/workspaces'))
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

  // Both mutations answer with the whole new list, so there is nothing to
  // refetch and no window in which the sidebar disagrees with the server.
  const apply = useCallback(async (request: Promise<Response>) => {
    setError(undefined)
    try {
      setWorkspaces(await listOrReason(request))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [])

  const add = useCallback(
    (path: string) =>
      apply(
        fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path }),
        }),
      ),
    [apply],
  )

  const remove = useCallback(
    (id: string) => apply(fetch(`/api/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    [apply],
  )

  return { workspaces, loading, error, add, remove }
}
