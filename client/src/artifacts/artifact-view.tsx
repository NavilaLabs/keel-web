import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import type { ArtifactRef, StubFingerprint } from '@keel-web/protocol'
import { ArchitecturePane } from '../architecture/architecture-pane.tsx'
import type { OpenArtifact } from './types.ts'

const markdownKinds = new Set<ArtifactRef['kind']>(['knowledge', 'adr', 'document'])

/**
 * A path relative to the artefact that names it, kept inside the repository.
 *
 * Returns nothing for a link that climbs out or is not relative, so an
 * absolute link and a foreign one are left to the browser.
 */
function resolveWithin(from: string, href: string): string | undefined {
  if (href.startsWith('#') || /^[a-z]+:/i.test(href) || href.startsWith('//')) return undefined

  const base = from.split('/').slice(0, -1)
  const segments = href.split('/')
  const resolved = href.startsWith('/') ? [] : base

  const path: string[] = [...resolved]
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (path.length === 0) return undefined
      path.pop()
      continue
    }
    path.push(segment)
  }
  return path.length === 0 ? undefined : path.join('/')
}

type TicketFile = Extract<ArtifactRef, { repository: 'ticket' }>

function kindOf(path: string): TicketFile['kind'] {
  if (path.endsWith('.c4')) return 'c4Source'
  if (!path.endsWith('.md')) return 'file'
  return path.includes('/adr/') ? 'adr' : 'document'
}

function Fingerprint({ fingerprint }: { fingerprint: StubFingerprint }) {
  return (
    <p
      className={`border-l-2 py-1 pl-3 text-[13px] leading-relaxed ${
        fingerprint.matches ? 'border-border text-muted-foreground' : 'border-keel text-foreground'
      }`}
    >
      {fingerprint.matches
        ? 'This file still says what it said when the contract was frozen.'
        : 'This file has changed since the contract was frozen. That is expected once implementation starts.'}
    </p>
  )
}

/**
 * Highlighted source, once the highlighter has loaded.
 *
 * It is imported on first use rather than with the page: most artefacts are
 * documents, and a reader who never opens a stub never pays for it.
 */
function Source({ text, language }: { text: string; language: string }) {
  const [highlighted, setHighlighted] = useState<string>()

  useEffect(() => {
    let current = true
    void (async () => {
      try {
        // The fine-grained entry points, not the `shiki` bundle: that one
        // carries every grammar it knows, and this view only ever shows
        // TypeScript. The JavaScript engine avoids the WebAssembly payload.
        const [
          { createHighlighterCore },
          { createJavaScriptRegexEngine },
          typescript,
          light,
          dark,
        ] = await Promise.all([
          import('shiki/core'),
          import('shiki/engine/javascript'),
          import('@shikijs/langs/typescript'),
          import('@shikijs/themes/github-light'),
          import('@shikijs/themes/github-dark'),
        ])
        const highlighter = await createHighlighterCore({
          langs: [typescript.default],
          themes: [light.default, dark.default],
          engine: createJavaScriptRegexEngine(),
        })
        const html = highlighter.codeToHtml(text, {
          lang: language === 'typescript' ? 'typescript' : 'text',
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
        })
        highlighter.dispose()
        if (current) setHighlighted(html)
      } catch {
        if (current) setHighlighted(undefined)
      }
    })()
    return () => {
      current = false
    }
  }, [text, language])

  if (highlighted === undefined) {
    return (
      <pre className="overflow-x-auto bg-code p-3 font-mono text-[13px] leading-[1.6]">{text}</pre>
    )
  }

  return (
    <div
      className="overflow-x-auto bg-code p-3 font-mono text-[13px] leading-[1.6] [&_pre]:bg-transparent"
      // Shiki's output, built from the file this view is showing.
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  )
}

function Document({
  text,
  path,
  onOpen,
}: {
  text: string
  path: string
  onOpen: (ref: ArtifactRef) => void
}) {
  return (
    <div className="max-w-[78ch] text-[15px] leading-[1.7] text-foreground [&>*+*]:mt-4 [&_a]:text-keel [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:bg-code [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px] [&_h1]:text-[19px] [&_h1]:font-medium [&_h2]:mt-7 [&_h2]:text-[16px] [&_h2]:font-medium [&_h3]:mt-5 [&_h3]:text-[15px] [&_h3]:font-medium [&_hr]:border-border [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:bg-code [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_table]:border-collapse [&_td]:border-t [&_td]:border-border [&_td]:py-1.5 [&_td]:pr-4 [&_th]:py-1.5 [&_th]:pr-4 [&_th]:text-left [&_th]:font-medium [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={{
          a({ href, children, ...rest }) {
            const within = href === undefined ? undefined : resolveWithin(path, href)
            if (within === undefined) {
              return (
                <a href={href} target="_blank" rel="noreferrer" {...rest}>
                  {children}
                </a>
              )
            }
            // A relative link here names a file on disk, which the browser
            // would resolve against this page and miss. It opens as an
            // artefact instead.
            return (
              <a
                href={href}
                onClick={(clicked) => {
                  clicked.preventDefault()
                  onOpen({ kind: kindOf(within), repository: 'ticket', path: within })
                }}
                {...rest}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

export function ArtifactView({
  artifact,
  workspaceId,
  onOpen,
}: {
  artifact: OpenArtifact
  workspaceId: string
  onOpen: (ref: ArtifactRef) => void
}) {
  if (artifact.ref.kind === 'c4View') {
    return (
      <ArchitecturePane
        // Keyed by the view, so moving to another one starts from nothing
        // rather than from the previous diagram's state.
        key={`${artifact.ref.view}-${artifact.ref.branch ?? ''}`}
        workspaceId={workspaceId}
        view={artifact.ref.view}
        branch={artifact.ref.branch}
        onOpen={onOpen}
      />
    )
  }

  if (artifact.error !== undefined) {
    return <p className="text-[13px] leading-relaxed text-destructive">{artifact.error}</p>
  }
  if (artifact.content === undefined) {
    return <p className="text-[13px] text-muted-foreground">Reading</p>
  }

  const { ref, content } = { ref: artifact.ref, content: artifact.content }

  if (markdownKinds.has(ref.kind) && ref.kind !== 'stub' && 'path' in ref) {
    return <Document text={content.text} path={ref.path} onOpen={onOpen} />
  }

  return (
    <div className="flex flex-col gap-3">
      {content.fingerprint && <Fingerprint fingerprint={content.fingerprint} />}
      <Source
        text={content.text}
        language={ref.kind === 'stub' ? 'typescript' : ref.kind === 'c4Source' ? 'text' : 'text'}
      />
    </div>
  )
}
