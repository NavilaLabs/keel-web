import { Component, type ReactNode } from 'react'

interface BoundaryProperties {
  children: ReactNode
}

interface BoundaryState {
  failure?: string
}

/**
 * Keeps a failing diagram from taking the rest of the page with it.
 *
 * The diagram runtime is the one part of this client that is not ours. An
 * error thrown inside it would otherwise unmount everything, leaving a blank
 * page that survives navigating away, because there is nothing left to
 * navigate. Here it costs one artefact view and says what happened.
 */
export class DiagramBoundary extends Component<BoundaryProperties, BoundaryState> {
  override state: BoundaryState = {}

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failure: error instanceof Error ? error.message : String(error) }
  }

  override render() {
    const { failure } = this.state
    if (failure === undefined) return this.props.children

    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px] leading-relaxed text-destructive">
          This diagram could not be drawn.
        </p>
        <pre className="overflow-x-auto bg-code p-3 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap">
          {failure}
        </pre>
      </div>
    )
  }
}
