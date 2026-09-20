import { Suspense, lazy, useEffect, useState } from 'react'
import type { ArchitectureView, ArtifactRef } from '@keel-web/protocol'
import { DiagramBoundary } from './diagram-boundary.tsx'

// likec4 brings a diagram runtime an order of magnitude larger than the rest
// of this client. A reader who never opens a view never loads it.
const DiagramView = lazy(async () => ({
  default: (await import('./diagram-view.tsx')).DiagramView,
}))

interface PaneProperties {
  workspaceId: string
  view: string
  branch?: string
  onOpen: (ref: ArtifactRef) => void
}

/**
 * Fetches one laid-out view and hands it to the diagram.
 *
 * The diagram itself neither fetches nor lays out; keeping that here is what
 * lets it draw the as-is model and a ticket's to-be model without knowing
 * which it is looking at.
 */
export function ArchitecturePane({ workspaceId, view, branch, onOpen }: PaneProperties) {
  const [laidOut, setLaidOut] = useState<ArchitectureView>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let current = true
    const query = new URLSearchParams({ view })
    if (branch) query.set('branch', branch)

    void (async () => {
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/architecture?${query.toString()}`,
        )
        const body: unknown = await response.json()
        if (!current) return
        if (!response.ok) {
          const reason = (body as { reason?: unknown }).reason
          setError(typeof reason === 'string' ? reason : 'This view could not be read.')
          return
        }
        setLaidOut(body as ArchitectureView)
      } catch {
        if (current) setError('keel-web could not be reached.')
      }
    })()

    return () => {
      current = false
    }
  }, [workspaceId, view, branch])

  if (error !== undefined) {
    return <p className="text-[13px] leading-relaxed text-destructive">{error}</p>
  }
  if (laidOut === undefined) {
    return <p className="text-[13px] text-muted-foreground">Laying out</p>
  }

  return (
    <DiagramBoundary>
      <Suspense fallback={<p className="text-[13px] text-muted-foreground">Drawing</p>}>
        <DiagramView
          view={laidOut}
          onNavigate={(next) => onOpen({ kind: 'c4View', view: next, ...(branch && { branch }) })}
          onFollowLink={(ref) => {
            if (ref) onOpen(ref)
          }}
        />
      </Suspense>
    </DiagramBoundary>
  )
}
