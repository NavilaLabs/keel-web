import { useMemo, useRef } from 'react'
import { createLikeC4Model } from 'likec4/model'
import { LikeC4ModelProvider, ReactLikeC4 } from 'likec4/react'
import { artifactOfLink } from './follow-link.ts'
import type { DiagramViewProps } from './types.ts'

export function DiagramView({ view, onNavigate, onFollowLink }: DiagramViewProps) {
  const model = useMemo(() => createLikeC4Model(view.model as never), [view.model])
  const container = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={container}
      className="h-full min-h-96 w-full"
      // Element links live inside the diagram's shadow DOM, and a browser
      // would resolve them against this page. The click is taken here, where
      // it arrives composed, and turned into an artefact instead.
      onClickCapture={(clicked) => {
        if (onFollowLink === undefined) return
        const anchor = clicked.nativeEvent
          .composedPath()
          .find(
            (target): target is HTMLAnchorElement =>
              target instanceof HTMLAnchorElement && target.hasAttribute('href'),
          )
        const href = anchor?.getAttribute('href')
        if (!href) return
        const artifact = artifactOfLink(href)
        if (artifact === undefined) return
        clicked.preventDefault()
        clicked.stopPropagation()
        onFollowLink(artifact, href)
      }}
    >
      <LikeC4ModelProvider likec4model={model}>
        <ReactLikeC4
          viewId={view.view as never}
          background="transparent"
          controls
          enableElementDetails
          enableRelationshipBrowser={false}
          enableSearch={false}
          showNavigationButtons
          onNavigateTo={(next) => onNavigate?.(next)}
        />
      </LikeC4ModelProvider>
    </div>
  )
}
