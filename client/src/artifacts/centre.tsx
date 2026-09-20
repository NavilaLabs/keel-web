import type { ArtifactRef } from '@keel-web/protocol'
import { ArtifactTree } from './artifact-tree.tsx'
import { ArtifactView } from './artifact-view.tsx'
import type { CentreSnapshot, CentreStore } from './types.ts'

interface CentreProperties {
  centre: CentreStore
  snapshot: CentreSnapshot
  onOpen: (ref: ArtifactRef) => void
}

export function Centre({ centre, snapshot, onOpen }: CentreProperties) {
  const active = snapshot.active === undefined ? undefined : snapshot.open[snapshot.active]

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="w-56 shrink-0 overflow-y-auto border-r border-border">
        <ArtifactTree
          tree={snapshot.tree}
          error={snapshot.treeError}
          active={active?.ref}
          onOpen={onOpen}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {snapshot.open.length > 0 && (
          <div role="tablist" className="flex shrink-0 overflow-x-auto border-b border-border">
            {snapshot.open.map((artifact, index) => {
              const current = index === snapshot.active
              return (
                <div
                  key={`${artifact.ref.kind}-${artifact.label}-${index}`}
                  className={`group flex items-center border-b-2 ${
                    current ? 'border-keel' : 'border-transparent'
                  }`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={current}
                    onClick={() => centre.activate(index)}
                    className={`max-w-56 truncate py-2 pr-1 pl-3 text-left text-[13px] focus-visible:outline-none ${
                      current ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {artifact.label}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${artifact.label}`}
                    onClick={() => centre.close(index)}
                    className="px-2 text-[13px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none"
                  >
                    &times;
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Keyed by the artefact, so switching tabs starts at the top while a
            rewrite of the open one leaves the reader where they were. */}
        <div
          key={active === undefined ? 'none' : `${active.ref.kind}-${active.label}`}
          role="tabpanel"
          className="min-h-0 flex-1 overflow-y-auto px-8 py-7"
        >
          {active === undefined ? (
            <p className="max-w-[40ch] text-[13px] leading-relaxed text-muted-foreground">
              Pick an artefact on the left. keel brings one to the front by itself when the
              workflow reaches a step that is about it.
            </p>
          ) : (
            <ArtifactView artifact={active} onOpen={onOpen} />
          )}
        </div>
      </div>
    </div>
  )
}
