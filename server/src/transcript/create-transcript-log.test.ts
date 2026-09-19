import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTranscriptLog } from './create-transcript-log.js'
import type { TranscriptLog } from './types.js'

describe('transcript log', () => {
  let directory: string
  let log: TranscriptLog

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'transcript-'))
    log = createTranscriptLog(directory)
  })

  it('numbers events from one, without gaps', async () => {
    const first = await log.append('7', { type: 'user.message', text: 'hello' })
    const second = await log.append('7', { type: 'assistant.message', text: 'hi' })

    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(first.ticketId).toBe('7')
  })

  it('keeps sequence numbers per ticket', async () => {
    await log.append('7', { type: 'user.message', text: 'a' })
    const other = await log.append('8', { type: 'user.message', text: 'b' })

    expect(other.seq).toBe(1)
  })

  it('does not interleave concurrent appends', async () => {
    const appended = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        log.append('7', { type: 'user.message', text: String(index) }),
      ),
    )

    expect([...appended].map((event) => event.seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    )
  })

  it('replays everything after a sequence number', async () => {
    for (const text of ['a', 'b', 'c']) await log.append('7', { type: 'user.message', text })

    const replayed = await log.since('7', 1)

    expect(replayed.map((event) => event.seq)).toEqual([2, 3])
  })

  it('treats an unknown ticket as empty rather than failing', async () => {
    await expect(log.since('unknown', 0)).resolves.toEqual([])
    await expect(log.lastSequence('unknown')).resolves.toBe(0)
  })

  it('reads its sequence back from disk', async () => {
    await log.append('7', { type: 'user.message', text: 'a' })

    const reopened = createTranscriptLog(directory)

    expect(await reopened.lastSequence('7')).toBe(1)
    expect((await reopened.append('7', { type: 'user.message', text: 'b' })).seq).toBe(2)
  })

  it('refuses a ticket id that is not usable as a file name', async () => {
    await expect(log.append('../escape', { type: 'user.message', text: 'a' })).rejects.toThrow()
  })
})
