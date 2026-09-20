import type { ArtifactRef } from '@keel-web/protocol'

/**
 * A `link` on an element, turned into the artefact it names.
 *
 * Those links are written relative to the ticket repository, pointing into
 * the code repository beside it, so `../../keel-web/server/src/index.ts`
 * leaves the ticket repository by design. Only that shape is understood; an
 * absolute or foreign link is left alone.
 */
export function artifactOfLink(href: string): ArtifactRef | undefined {
  if (/^[a-z]+:/i.test(href) || href.startsWith('/') || href.startsWith('#')) return undefined

  const segments: string[] = []
  let climbed = 0
  for (const segment of href.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0) segments.pop()
      else climbed += 1
      continue
    }
    segments.push(segment)
  }
  if (segments.length === 0) return undefined

  const path = segments.join('/')
  // Two levels up from `architecture/` is beside the ticket repository, which
  // is where the code repository sits.
  if (climbed >= 2) {
    const withoutRepository = segments.slice(1).join('/')
    return withoutRepository === ''
      ? undefined
      : { kind: 'stub', repository: 'code', path: withoutRepository }
  }
  return { kind: path.endsWith('.c4') ? 'c4Source' : 'file', repository: 'ticket', path }
}
