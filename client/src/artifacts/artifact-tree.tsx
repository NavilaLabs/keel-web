import { useState } from 'react'
import type { ArtifactNode, ArtifactRef, ArtifactTree as Tree } from '@keel-web/protocol'
import { sameArtifact } from './create-centre-store.ts'

interface TreeProperties {
  tree?: Tree
  error?: string
  active?: ArtifactRef
  onOpen: (ref: ArtifactRef) => void
}

/** A group the developer is not meant to reach for first, and which starts closed. */
const quiet = new Set(['Workflow', 'Sources'])

function Group({
  node,
  depth,
  active,
  onOpen,
}: {
  node: Extract<ArtifactNode, { type: 'group' }>
  depth: number
  active?: ArtifactRef
  onOpen: (ref: ArtifactRef) => void
}) {
  const [open, setOpen] = useState(!quiet.has(node.label))

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
        className="flex w-full items-center gap-1.5 py-1 text-left text-[12px] tracking-wide text-muted-foreground uppercase hover:text-foreground focus-visible:outline-none"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <span aria-hidden className="text-[10px]">
          {open ? '▾' : '▸'}
        </span>
        <span className="truncate">{node.label}</span>
      </button>
      {open && <Nodes nodes={node.children} depth={depth + 1} active={active} onOpen={onOpen} />}
    </li>
  )
}

function Nodes({
  nodes,
  depth,
  active,
  onOpen,
}: {
  nodes: readonly ArtifactNode[]
  depth: number
  active?: ArtifactRef
  onOpen: (ref: ArtifactRef) => void
}) {
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} className="flex flex-col">
      {nodes.map((node, index) =>
        node.type === 'group' ? (
          <Group
            key={`${node.label}-${index}`}
            node={node}
            depth={depth}
            active={active}
            onOpen={onOpen}
          />
        ) : (
          <li key={`${node.label}-${index}`} role="treeitem" aria-selected={isActive(node, active)}>
            <button
              type="button"
              onClick={() => onOpen(node.ref)}
              style={{ paddingLeft: `${depth * 12 + 14}px` }}
              className={`-ml-px block w-full truncate border-l-2 py-1 pr-2 text-left text-[13px] focus-visible:outline-none ${
                isActive(node, active)
                  ? 'border-keel text-foreground'
                  : `border-transparent hover:border-border hover:text-foreground ${
                      node.named ? 'text-foreground/80' : 'text-muted-foreground'
                    }`
              }`}
            >
              {node.label}
            </button>
          </li>
        ),
      )}
    </ul>
  )
}

function isActive(
  node: Extract<ArtifactNode, { type: 'artifact' }>,
  active?: ArtifactRef,
): boolean {
  return active !== undefined && sameArtifact(node.ref, active)
}

export function ArtifactTree({ tree, error, active, onOpen }: TreeProperties) {
  if (error !== undefined) {
    return <p className="px-3 py-2 text-[13px] leading-relaxed text-destructive">{error}</p>
  }
  if (tree === undefined) {
    return <p className="px-3 py-2 text-[13px] text-muted-foreground">Reading</p>
  }
  if (tree.nodes.length === 0) {
    return (
      <p className="px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
        {tree.reason ?? 'Nothing to read for this ticket yet.'}
      </p>
    )
  }

  return (
    <div className="py-2">
      <Nodes nodes={tree.nodes} depth={0} active={active} onOpen={onOpen} />
    </div>
  )
}
