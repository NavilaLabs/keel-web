import type { FileEntry } from '@keel-web/protocol'
import { describe, expect, it } from 'vitest'
import { rank, scoreOf } from './rank.js'

const entries: FileEntry[] = [
  { path: 'client', kind: 'directory' },
  { path: 'client/src', kind: 'directory' },
  { path: 'client/src/chat/chat-column.tsx', kind: 'file' },
  { path: 'server/src/chat/create-chat-routes.ts', kind: 'file' },
  { path: 'README.md', kind: 'file' },
]

function paths(query: string, limit = 10): string[] {
  return rank(entries, query, limit).entries.map((entry) => entry.path)
}

describe('scoring a path against a query', () => {
  it('matches characters in order rather than as a substring', () => {
    expect(scoreOf('client/src', 'csr')).toBeDefined()
    expect(scoreOf('client/src', 'rsc')).toBeUndefined()
  })

  it('prefers a match in the filename over one in the directories above it', () => {
    const inName = scoreOf('server/chat.ts', 'chat') as number
    const inPath = scoreOf('chat/server.ts', 'chat') as number

    expect(inName).toBeGreaterThan(inPath)
  })

  it('prefers characters that run together', () => {
    const together = scoreOf('chat.ts', 'chat') as number
    const scattered = scoreOf('c-h-a-t.ts', 'chat') as number

    expect(together).toBeGreaterThan(scattered)
  })

  it('ignores case in both directions', () => {
    expect(scoreOf('README.md', 'readme')).toBeDefined()
    expect(scoreOf('readme.md', 'README')).toBeDefined()
  })
})

describe('ranking the entries', () => {
  it('keeps the index order for an empty query, so the shallowest come first', () => {
    expect(paths('')[0]).toBe('client')
  })

  it('narrows on a query that carries a separator', () => {
    expect(paths('client/src/chat')).toEqual(['client/src/chat/chat-column.tsx'])
  })

  it('says when it had more to offer than the limit allowed', () => {
    const found = rank(entries, 'c', 2)

    expect(found.entries).toHaveLength(2)
    expect(found.truncated).toBe(true)
  })

  it('does not call a complete answer truncated', () => {
    expect(rank(entries, 'README', 10).truncated).toBe(false)
  })

  it('answers nothing for a query no path matches', () => {
    expect(paths('zzz')).toEqual([])
  })
})
