import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sequence, ServerEvent, ServerEventBody, TicketId } from '@keel-web/protocol'
import type { CreateTranscriptLog, TranscriptLog } from './types.js'

const fileNamePattern = /^[A-Za-z0-9._-]+$/

function fileFor(directory: string, ticketId: TicketId): string {
  if (!fileNamePattern.test(ticketId)) {
    throw new Error(`Ticket id is not usable as a file name: ${ticketId}`)
  }
  return join(directory, `${ticketId}.jsonl`)
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

export const createTranscriptLog: CreateTranscriptLog = (directory: string): TranscriptLog => {
  const lastSequences = new Map<TicketId, Sequence>()
  const writes = new Map<TicketId, Promise<unknown>>()

  // Keeps one append at a time per ticket, so sequence numbers cannot interleave.
  function serialise<T>(ticketId: TicketId, work: () => Promise<T>): Promise<T> {
    const previous = writes.get(ticketId) ?? Promise.resolve()
    const next = previous.then(work, work)
    writes.set(
      ticketId,
      next.catch(() => undefined),
    )
    return next
  }

  async function currentLastSequence(ticketId: TicketId): Promise<Sequence> {
    const known = lastSequences.get(ticketId)
    if (known !== undefined) return known
    const events = await readEvents(fileFor(directory, ticketId))
    const last = events.at(-1)?.seq ?? 0
    lastSequences.set(ticketId, last)
    return last
  }

  return {
    append(ticketId, body: ServerEventBody) {
      return serialise(ticketId, async () => {
        const seq = (await currentLastSequence(ticketId)) + 1
        const event = { seq, ticketId, ...body } as ServerEvent
        await mkdir(directory, { recursive: true })
        await appendFile(fileFor(directory, ticketId), `${JSON.stringify(event)}\n`, 'utf8')
        lastSequences.set(ticketId, seq)
        return event
      })
    },

    async since(ticketId, afterSeq) {
      const events = await readEvents(fileFor(directory, ticketId))
      return events.filter((event) => event.seq > afterSeq)
    },

    lastSequence(ticketId) {
      return serialise(ticketId, () => currentLastSequence(ticketId))
    },
  }
}
