import { useCallback, useSyncExternalStore } from 'react'
import { createRouter } from './create-router.ts'
import type { Route, Router } from './types.ts'

const router: Router = createRouter()
const listeners = new Set<() => void>()

/**
 * Replaced only when the route really changes, so it can be handed to
 * `useSyncExternalStore` as the snapshot directly.
 */
let snapshot: Route = router.current()

function refresh(): void {
  const next = router.current()
  if (
    next.workspaceId === snapshot.workspaceId &&
    next.ticketId === snapshot.ticketId &&
    next.view === snapshot.view
  ) {
    return
  }
  snapshot = next
  for (const listener of listeners) listener()
}

router.subscribe(refresh)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Route {
  return snapshot
}

export function useRoute(): { route: Route; navigate: (route: Route) => void } {
  const route = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // `navigate` does not fire popstate, so the snapshot is refreshed here.
  const navigate = useCallback((next: Route) => {
    router.navigate(next)
    refresh()
  }, [])

  return { route, navigate }
}
