import type { FileEntry } from '@keel-web/protocol'

/** Where a new word starts, which is where a typed character is worth more. */
const boundaries = new Set(['/', '-', '_', '.'])

const consecutiveBonus = 8
const boundaryBonus = 6
const filenameBonus = 4

/**
 * How well a path answers a query, or undefined when it does not.
 *
 * The query matches when its characters appear in the path in order, ignoring
 * case, which is what lets `csr` find `client/src`. A path scores higher when
 * the matched characters run together, sit at the start of a word, and lie in
 * the filename rather than in the directories leading to it. A long path
 * scores slightly lower, so the shallower of two equally good matches wins.
 */
export function scoreOf(path: string, query: string): number | undefined {
  const lowerPath = path.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const filenameAt = path.lastIndexOf('/') + 1

  let total = 0
  let from = 0
  let previous = -1

  for (const wanted of lowerQuery) {
    const found = lowerPath.indexOf(wanted, from)
    if (found === -1) return undefined

    total += 1
    if (found === previous + 1) total += consecutiveBonus
    if (found >= filenameAt) total += filenameBonus
    if (found === 0 || boundaries.has(path[found - 1] as string)) total += boundaryBonus

    previous = found
    from = found + 1
  }

  return total - path.length / 100
}

export interface Ranked {
  entries: FileEntry[]
  truncated: boolean
}

/**
 * The entries a query matches, best first, at most `limit` of them.
 *
 * An empty query keeps the order the index was built in, which puts the
 * shallowest paths first: that is what an `@` with nothing typed after it
 * should show.
 */
export function rank(entries: readonly FileEntry[], query: string, limit: number): Ranked {
  if (query === '') {
    return { entries: entries.slice(0, limit), truncated: entries.length > limit }
  }

  const scored: { entry: FileEntry; score: number }[] = []
  for (const entry of entries) {
    const score = scoreOf(entry.path, query)
    if (score !== undefined) scored.push({ entry, score })
  }

  scored.sort(
    (one, other) => other.score - one.score || one.entry.path.localeCompare(other.entry.path),
  )
  return {
    entries: scored.slice(0, limit).map((one) => one.entry),
    truncated: scored.length > limit,
  }
}
