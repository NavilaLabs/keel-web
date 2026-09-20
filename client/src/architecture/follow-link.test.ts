import { describe, expect, it } from 'vitest'
import { artifactOfLink } from './follow-link.ts'

describe('following an element link', () => {
  it('reads a link into the code repository as a stub', () => {
    expect(artifactOfLink('../../keel-web/server/src/index.ts')).toEqual({
      kind: 'stub',
      repository: 'code',
      path: 'server/src/index.ts',
    })
  })

  it('keeps a link inside the ticket repository where it is', () => {
    expect(artifactOfLink('views.c4')).toEqual({
      kind: 'c4Source',
      repository: 'ticket',
      path: 'views.c4',
    })
  })

  it('leaves an absolute or foreign link to the browser', () => {
    expect(artifactOfLink('https://example.com')).toBeUndefined()
    expect(artifactOfLink('/etc/passwd')).toBeUndefined()
    expect(artifactOfLink('#section')).toBeUndefined()
  })

  it('reads nothing from a link that names no file', () => {
    expect(artifactOfLink('../..')).toBeUndefined()
  })
})
