import { readFile, unwatchFile, watchFile } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ArtifactHint, ArtifactRef } from '@keel-web/protocol'
import type { CreateHintFollower, HintFollower, ReadHint } from './types.js'

const read = promisify(readFile)

const defaultFreshness = 60_000
const defaultInterval = 500

/** A ticket id becomes a path segment, so it may only be one. */
const safeSegment = /^[A-Za-z0-9._-]+$/

/**
 * One of keel's hint targets, as an artefact reference.
 *
 * The shapes agree by design, so this is a rename rather than a translation.
 * A kind we do not know is dropped: keel may grow one, and a stream that
 * stops working because of it would be worse than a hint that names one
 * artefact fewer.
 */
function refOf(target: Record<string, unknown>): ArtifactRef | undefined {
  const kind = target.kind
  const path = typeof target.path === 'string' ? target.path : undefined

  if (kind === 'c4_view' && typeof target.view === 'string') {
    const branch = typeof target.branch === 'string' ? target.branch : undefined
    return { kind: 'c4View', view: target.view, ...(branch && { branch }) }
  }
  if (path === undefined) return undefined
  if (kind === 'stub') {
    const symbol = typeof target.symbol === 'string' ? target.symbol : undefined
    return { kind: 'stub', repository: 'code', path, ...(symbol && { symbol }) }
  }
  if (kind === 'knowledge' || kind === 'adr') {
    return { kind, repository: 'ticket', path }
  }
  return undefined
}

function hintOf(line: string): ArtifactHint | undefined {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(line) as Record<string, unknown>
  } catch {
    // keel appends whole lines, but a reader can still catch a write in
    // progress. The line comes back complete on the next read.
    return undefined
  }
  if (parsed.type !== 'artifact_hint' || !Array.isArray(parsed.targets)) return undefined

  const targets = parsed.targets
    .map((target) => refOf(target as Record<string, unknown>))
    .filter((target): target is ArtifactRef => target !== undefined)
  if (targets.length === 0) return undefined

  return {
    at: typeof parsed.at === 'string' ? parsed.at : new Date().toISOString(),
    ...(typeof parsed.step === 'string' && { step: parsed.step }),
    ...(parsed.block === null || typeof parsed.block === 'string' ? { block: parsed.block } : {}),
    ...(typeof parsed.consultation === 'string' && { consultation: parsed.consultation }),
    targets,
  }
}

/**
 * Every hint in the file, with the reading position after each.
 *
 * The whole file is read rather than the tail: keel states it stays at a few
 * hundred lines per ticket, and reading by path handles the case a byte
 * offset cannot, which is git replacing the file under us on a checkout.
 */
function hintsIn(content: Buffer): ReadHint[] {
  const found: ReadHint[] = []
  let start = 0

  while (start < content.length) {
    const end = content.indexOf(0x0a, start)
    // A line without its newline is still being written.
    if (end === -1) break
    const hint = hintOf(content.toString('utf8', start, end))
    if (hint) found.push({ offset: end + 1, hint })
    start = end + 1
  }
  return found
}

export const createHintFollower: CreateHintFollower = (options): HintFollower => {
  const freshness = options?.freshness ?? defaultFreshness
  const interval = options?.interval ?? defaultInterval

  return {
    follow(workspace, ticketId, listener, after) {
      if (!workspace.ticketRepository || !safeSegment.test(ticketId)) {
        return () => {}
      }

      const path = join(workspace.ticketRepository, 'tickets', ticketId, 'events.jsonl')
      let cursor = after
      let reading = false
      let stopped = false

      const deliver = async () => {
        if (reading || stopped) return
        reading = true
        try {
          const content = await read(path).catch(() => undefined)
          if (content === undefined) {
            // A ticket keel has not touched yet has no stream. Nothing is
            // history when there is nothing, so everything that appears
            // later was appended after this listener arrived.
            cursor ??= 0
            return
          }
          if (stopped) return

          // Shorter than where we stopped means the file was replaced, by a
          // checkout or a rebase. Its old positions mean nothing now.
          if (cursor !== undefined && cursor > content.length) cursor = content.length

          const found = hintsIn(content)
          if (cursor === undefined) {
            // First look. What is already there is history: acting on it
            // would drag the view somewhere the developer left long ago.
            cursor = content.length
            return
          }

          const start = cursor
          for (const candidate of found) {
            if (candidate.offset <= start) continue
            cursor = candidate.offset
            // A hint that old belongs to a session the developer has walked
            // away from. A reconnect takes seconds; a slept laptop does not.
            if (Date.now() - Date.parse(candidate.hint.at) > freshness) continue
            listener(candidate)
          }
          if (cursor < content.length) cursor = content.length
        } finally {
          reading = false
        }
      }

      // Watching by polling the file's stats rather than by inode: this file
      // is tracked by git, and a checkout replaces it, which an inode watch
      // would not survive.
      const onChange = () => void deliver()
      watchFile(path, { interval }, onChange)
      void deliver()

      return (): void => {
        stopped = true
        unwatchFile(path, onChange)
      }
    },
  }
}
