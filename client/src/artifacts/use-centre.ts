import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { TicketId } from '@keel-web/protocol'
import { createCentreStore } from './create-centre-store.ts'
import type { CentreSnapshot, CentreStore } from './types.ts'

/**
 * The centre store for one workspace, and what it currently shows.
 *
 * The store outlives renders and owns its own polling, so the component tree
 * only points it at a ticket and reads from it.
 */
export function useCentre(
  workspaceId: string | undefined,
  ticketId: TicketId | undefined,
): { centre: CentreStore | undefined; snapshot: CentreSnapshot } {
  const centre = useMemo(
    () => (workspaceId === undefined ? undefined : createCentreStore({ workspaceId })),
    [workspaceId],
  )

  useEffect(() => () => centre?.dispose(), [centre])
  useEffect(() => centre?.select(ticketId), [centre, ticketId])

  const snapshot = useSyncExternalStore(
    (listener) => centre?.subscribe(listener) ?? (() => {}),
    () => centre?.snapshot() ?? empty,
    () => empty,
  )

  return { centre, snapshot }
}

const empty: CentreSnapshot = { open: [] }
