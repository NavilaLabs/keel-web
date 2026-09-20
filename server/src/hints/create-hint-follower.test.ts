import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactHint } from '@keel-web/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Workspace } from '../workspaces/types.js'
import { createHintFollower } from './create-hint-follower.js'
import type { ReadHint } from './types.js'

let repository: string
let stream: string
let workspace: Workspace

const settle = (milliseconds = 60) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function line(at: string, targets: unknown[], extra: Record<string, unknown> = {}) {
  return `${JSON.stringify({ at, type: 'artifact_hint', targets, ...extra })}\n`
}

const knowledge = { kind: 'knowledge', repo: 'ticket', path: 'tickets/9/knowledge.md' }

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), 'keel-hints-'))
  await mkdir(join(repository, 'tickets/9'), { recursive: true })
  stream = join(repository, 'tickets/9/events.jsonl')
  await writeFile(stream, line(new Date().toISOString(), [knowledge]))
  workspace = {
    id: 'w1',
    name: 'keel-web',
    path: repository,
    reachable: true,
    ticketRepository: repository,
  }
})

afterEach(async () => {
  await rm(repository, { recursive: true, force: true })
})

describe('following the hints of a ticket', () => {
  it('hears nothing of what was already in the file', async () => {
    const follower = createHintFollower({ interval: 20 })
    const heard: ReadHint[] = []

    const stop = follower.follow(workspace, '9', (hint) => heard.push(hint))
    await settle()

    expect(heard).toEqual([])
    stop()
  })

  it('hears a hint appended while it listens', async () => {
    const follower = createHintFollower({ interval: 20 })
    const heard: ReadHint[] = []
    const stop = follower.follow(workspace, '9', (hint) => heard.push(hint))
    await settle()

    await appendFile(stream, line(new Date().toISOString(), [knowledge], { step: '5' }))
    await settle(120)

    expect(heard).toHaveLength(1)
    expect(heard[0]?.hint.step).toBe('5')
    stop()
  })

  it('renames keel targets into artefact references', async () => {
    const follower = createHintFollower({ interval: 20 })
    const heard: ReadHint[] = []
    const stop = follower.follow(workspace, '9', (hint) => heard.push(hint))
    await settle()

    await appendFile(
      stream,
      line(new Date().toISOString(), [
        { kind: 'c4_view', view: 'server', branch: 'ticket/9' },
        { kind: 'stub', repo: 'code', path: 'server/src/hints/types.ts', symbol: 'HintFollower' },
        { kind: 'something-new', repo: 'ticket', path: 'tickets/9/later.md' },
      ]),
    )
    await settle(120)

    expect(heard[0]?.hint.targets).toEqual([
      { kind: 'c4View', view: 'server', branch: 'ticket/9' },
      {
        kind: 'stub',
        repository: 'code',
        path: 'server/src/hints/types.ts',
        symbol: 'HintFollower',
      },
    ])
    stop()
  })

  it('resumes from a reading position, and never twice', async () => {
    const follower = createHintFollower({ interval: 20 })
    const first: ReadHint[] = []
    const stop = follower.follow(workspace, '9', (hint) => first.push(hint))
    await settle()
    await appendFile(stream, line(new Date().toISOString(), [knowledge], { step: '5' }))
    await settle(120)
    stop()

    const resumed: ReadHint[] = []
    const again = follower.follow(workspace, '9', (hint) => resumed.push(hint), first[0]?.offset)
    await settle(120)

    expect(first).toHaveLength(1)
    expect(resumed).toEqual([])
    again()
  })

  it('drops a hint too old to be worth acting on', async () => {
    const follower = createHintFollower({ interval: 20, freshness: 50 })
    const heard: ReadHint[] = []
    const stop = follower.follow(workspace, '9', (hint) => heard.push(hint))
    await settle()

    await appendFile(stream, line(new Date(Date.now() - 3_600_000).toISOString(), [knowledge]))
    await settle(120)

    expect(heard).toEqual([])
    stop()
  })

  it('starts over when the file was replaced by a shorter one', async () => {
    const follower = createHintFollower({ interval: 20 })
    const heard: ReadHint[] = []
    // A checkout or a rebase can put a different, shorter file at this path.
    // The position held then points into the middle of something else.
    const stop = follower.follow(workspace, '9', (hint) => heard.push(hint), 10_000)
    await settle()

    await writeFile(stream, '{}\n')
    await settle(120)

    expect(heard).toEqual([])
    stop()
  })

  it('waits for a ticket keel has not touched yet, rather than failing', async () => {
    const follower = createHintFollower({ interval: 20 })
    const heard: ReadHint[] = []

    const stop = follower.follow(workspace, '404', (hint) => heard.push(hint))
    await settle()

    await mkdir(join(repository, 'tickets/404'), { recursive: true })
    await writeFile(
      join(repository, 'tickets/404/events.jsonl'),
      line(new Date().toISOString(), [knowledge]),
    )
    await settle(200)

    expect(heard).toHaveLength(1)
    stop()
  })

  it('ignores a workspace with no ticket repository', () => {
    const follower = createHintFollower({ interval: 20 })

    const stop = follower.follow({ ...workspace, ticketRepository: undefined }, '9', () => {})

    expect(stop).toBeTypeOf('function')
    stop()
  })

  it('ignores an event that is not a hint', async () => {
    const follower = createHintFollower({ interval: 20 })
    const heard: ArtifactHint[] = []
    const stop = follower.follow(workspace, '9', (read) => heard.push(read.hint))
    await settle()

    await appendFile(
      stream,
      `${JSON.stringify({ at: new Date().toISOString(), type: 'step_changed' })}\n`,
    )
    await settle(120)

    expect(heard).toEqual([])
    stop()
  })
})
