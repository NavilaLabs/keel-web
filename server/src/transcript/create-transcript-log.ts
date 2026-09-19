import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Sequence, ServerEvent, ServerEventBody, SessionKey } from '@keel-web/protocol'
import type { WorkspaceRegistry } from '../workspaces/types.js'
import type { CreateTranscriptLog, TranscriptLog } from './types.js'

const safeSegment = /^[A-Za-z0-9._-]+$/

function keyOf(key: SessionKey): string {
  return `${key.workspaceId}/${key.ticketId}`
}

async function readEvents(file: string): Promise<ServerEvent[]> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ServerEvent)
}

export const createTranscriptLog: CreateTranscriptLog = (
  workspaces: WorkspaceRegistry,
): TranscriptLog => {
  const lastSequences = new Map<string, Sequence>()
  const writes = new Map<string, Promise<unknown>>()

  /** Throws rather than falling back, so a missing ticket repository is visible. */
  function fileFor(key: SessionKey): string {
    if (!safeSegment.test(key.ticketId)) {
      throw new Error(`Ticket id is not usable as a file name: ${key.ticketId}`)
    }
    const workspace = workspaces.find(key.workspaceId)
    if (workspace === undefined) throw new Error(`Unknown workspace: ${key.workspaceId}`)
    if (workspace.ticketRepository === undefined) {
      throw new Error(`Workspace ${workspace.name} has no ticket repository to record into.`)
    }
    return join(workspace.ticketRepository, 'tickets', key.ticketId, 'transcript.jsonl')
  }

  // Keeps one append at a time per session, so sequence numbers cannot interleave.
  function serialise<T>(key: SessionKey, work: () => Promise<T>): Promise<T> {
    const id = keyOf(key)
    const previous = writes.get(id) ?? Promise.resolve()
    const next = previous.then(work, work)
    writes.set(
      id,
      next.catch(() => undefined),
    )
    return next
  }

  async function currentLastSequence(key: SessionKey): Promise<Sequence> {
    const known = lastSequences.get(keyOf(key))
    if (known !== undefined) return known
    const events = await readEvents(fileFor(key))
    const last = events.at(-1)?.seq ?? 0
    lastSequences.set(keyOf(key), last)
    return last
  }

  return {
    append(key, body: ServerEventBody) {
      return serialise(key, async () => {
        const file = fileFor(key)
        const seq = (await currentLastSequence(key)) + 1
        const event = { seq, ...key, ...body } as ServerEvent
        await mkdir(dirname(file), { recursive: true })
        await appendFile(file, `${JSON.stringify(event)}\n`, 'utf8')
        lastSequences.set(keyOf(key), seq)
        return event
      })
    },

    async since(key, afterSeq) {
      const events = await readEvents(fileFor(key))
      return events.filter((event) => event.seq > afterSeq)
    },

    lastSequence(key) {
      return serialise(key, () => currentLastSequence(key))
    },

    async lastSessionId(key) {
      const events = await readEvents(fileFor(key))
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event?.type === 'session.started') return event.sessionId
      }
      return undefined
    },
  }
}
