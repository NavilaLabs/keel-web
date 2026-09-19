import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionKey } from '@keel-web/protocol'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Workspace, WorkspaceRegistry } from '../workspaces/types.js'
import { createTranscriptLog } from './create-transcript-log.js'
import type { TranscriptLog } from './types.js'

const seven: SessionKey = { workspaceId: 'w1', ticketId: '7' }
const eight: SessionKey = { workspaceId: 'w1', ticketId: '8' }

function registryOf(workspaces: readonly Workspace[]): WorkspaceRegistry {
  return {
    list: () => workspaces,
    find: (id) => workspaces.find((workspace) => workspace.id === id),
  }
}

describe('transcript log', () => {
  let directory: string
  let log: TranscriptLog

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'transcript-'))
    log = createTranscriptLog(
      registryOf([{ id: 'w1', name: 'one', path: '/code', ticketRepository: directory }]),
    )
  })

  it('numbers events from one, without gaps', async () => {
    const first = await log.append(seven, { type: 'user.message', text: 'hello' })
    const second = await log.append(seven, { type: 'assistant.message', text: 'hi' })

    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(first).toMatchObject(seven)
  })

  it('keeps sequence numbers per ticket', async () => {
    await log.append(seven, { type: 'user.message', text: 'a' })
    const other = await log.append(eight, { type: 'user.message', text: 'b' })

    expect(other.seq).toBe(1)
  })

  it('keeps a ticket of the same number in another workspace apart', async () => {
    const second = await mkdtemp(join(tmpdir(), 'transcript-other-'))
    const shared = createTranscriptLog(
      registryOf([
        { id: 'w1', name: 'one', path: '/code', ticketRepository: directory },
        { id: 'w2', name: 'two', path: '/other', ticketRepository: second },
      ]),
    )

    await shared.append(seven, { type: 'user.message', text: 'in one' })
    const elsewhere = await shared.append(
      { workspaceId: 'w2', ticketId: '7' },
      { type: 'user.message', text: 'in two' },
    )

    expect(elsewhere.seq).toBe(1)
    expect(await shared.since(seven, 0)).toHaveLength(1)
  })

  it('refuses a workspace that is not registered', async () => {
    await expect(
      log.append({ workspaceId: 'gone', ticketId: '7' }, { type: 'user.message', text: 'a' }),
    ).rejects.toThrow()
  })

  it('refuses a workspace without a ticket repository', async () => {
    const bare = createTranscriptLog(registryOf([{ id: 'w1', name: 'one', path: '/code' }]))

    await expect(bare.append(seven, { type: 'user.message', text: 'a' })).rejects.toThrow()
  })

  it('reports the session id the ticket last ran under', async () => {
    await log.append(seven, { type: 'session.started', sessionId: 's1', resumed: false })
    await log.append(seven, { type: 'user.message', text: 'a' })
    await log.append(seven, { type: 'session.started', sessionId: 's2', resumed: true })

    expect(await log.lastSessionId(seven)).toBe('s2')
    expect(await log.lastSessionId(eight)).toBeUndefined()
  })

  it('does not interleave concurrent appends', async () => {
    const appended = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        log.append(seven, { type: 'user.message', text: String(index) }),
      ),
    )

    expect([...appended].map((event) => event.seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    )
  })

  it('replays everything after a sequence number', async () => {
    for (const text of ['a', 'b', 'c']) await log.append(seven, { type: 'user.message', text })

    const replayed = await log.since(seven, 1)

    expect(replayed.map((event) => event.seq)).toEqual([2, 3])
  })

  it('treats an unknown ticket as empty rather than failing', async () => {
    await expect(log.since({ workspaceId: 'w1', ticketId: 'unknown' }, 0)).resolves.toEqual([])
    await expect(log.lastSequence({ workspaceId: 'w1', ticketId: 'unknown' })).resolves.toBe(0)
  })

  it('reads its sequence back from disk', async () => {
    await log.append(seven, { type: 'user.message', text: 'a' })

    const reopened = createTranscriptLog(
      registryOf([{ id: 'w1', name: 'one', path: '/code', ticketRepository: directory }]),
    )

    expect(await reopened.lastSequence(seven)).toBe(1)
    expect((await reopened.append(seven, { type: 'user.message', text: 'b' })).seq).toBe(2)
  })

  it('refuses a ticket id that is not usable as a file name', async () => {
    await expect(
      log.append({ workspaceId: 'w1', ticketId: '../escape' }, { type: 'user.message', text: 'a' }),
    ).rejects.toThrow()
  })
})
