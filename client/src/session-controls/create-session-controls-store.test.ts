import type { SessionControls, SessionControlsMessage, SessionKey } from '@keel-web/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, SendResult } from '../connection/types.ts'
import { createSessionControlsStore } from './create-session-controls-store.ts'
import type { SessionControlsStore } from './types.ts'

const four: SessionKey = { workspaceId: 'w1', ticketId: '4' }

const controls: SessionControls = {
  settings: { mode: 'acceptEdits', model: 'opus' },
  models: [{ value: 'opus', displayName: 'Opus 5', description: 'deep', effortLevels: ['high'] }],
  commands: [{ name: 'review', description: 'Reviews the diff', argumentHint: '' }],
}

function message(key: SessionKey = four, said = controls): SessionControlsMessage {
  return { type: 'session.controls', ...key, controls: said }
}

describe('session controls store', () => {
  let send: ReturnType<typeof vi.fn>
  let store: SessionControlsStore

  beforeEach(() => {
    send = vi.fn(async (): Promise<SendResult> => 'accepted')
    store = createSessionControlsStore({
      connection: { open: vi.fn(), send } as unknown as Connection,
    })
  })

  it('has nothing before the stream has said anything', () => {
    store.pointAt(four)

    expect(store.getControls()).toBeUndefined()
  })

  it('holds what the stream said and tells its listeners', () => {
    const listener = vi.fn()
    store.pointAt(four)
    store.subscribe(listener)

    store.take(message())

    expect(store.getControls()).toEqual(controls)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('returns the identical reference until something changes', () => {
    store.pointAt(four)
    store.take(message())

    expect(store.getControls()).toBe(store.getControls())
  })

  it('ignores what another session runs with', () => {
    store.pointAt(four)

    store.take(message({ workspaceId: 'w1', ticketId: '9' }))

    expect(store.getControls()).toBeUndefined()
  })

  it('drops what the previous session said when it is pointed elsewhere', () => {
    store.pointAt(four)
    store.take(message())

    store.pointAt({ workspaceId: 'w1', ticketId: '9' })

    expect(store.getControls()).toBeUndefined()
  })

  it('asks for a change and keeps showing what the session really runs with', async () => {
    store.pointAt(four)
    store.take(message())

    await expect(store.change({ mode: 'plan' })).resolves.toBe('accepted')

    expect(send).toHaveBeenCalledWith(four, { command: 'settings', change: { mode: 'plan' } })
    // The server confirms on the stream, so nothing changes here until it does.
    expect(store.getControls()?.settings.mode).toBe('acceptEdits')
  })

  it('reports a refused change as an outcome rather than an error', async () => {
    store.pointAt(four)
    send.mockResolvedValue('not_held')

    await expect(store.change({ model: 'gpt' })).resolves.toBe('refused')
  })

  it('changes nothing while it is pointed at no session', async () => {
    await expect(store.change({ mode: 'plan' })).resolves.toBe('no_session')

    expect(send).not.toHaveBeenCalled()
  })
})
