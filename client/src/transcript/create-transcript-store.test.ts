import type { ServerEvent, ServerEventBody, SessionKey } from '@keel-web/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, StreamHandlers } from '../connection/types.ts'
import { createTranscriptStore } from './create-transcript-store.ts'
import type { TranscriptStore } from './types.ts'

const four: SessionKey = { workspaceId: 'w1', ticketId: '4' }
const five: SessionKey = { workspaceId: 'w1', ticketId: '5' }

function event(seq: number, body: ServerEventBody): ServerEvent {
  return { seq, ...four, ...body } as ServerEvent
}

function connectionStub() {
  let handlers: StreamHandlers | undefined
  const closed: SessionKey[] = []
  const sent: unknown[] = []
  let opens = 0

  const connection: Connection = {
    open: (key, _afterSeq, given) => {
      opens += 1
      handlers = given
      return () => closed.push(key)
    },
    send: async (_key, command) => {
      sent.push(command)
      return 'accepted'
    },
  }

  return {
    connection,
    emit: (seq: number, body: ServerEventBody) => handlers?.onEvent(event(seq, body)),
    delta: (text: string) => handlers?.onDelta({ type: 'assistant.delta', ...four, text }),
    fatal: () => handlers?.onFatal('auth_required'),
    closed: () => closed,
    sent: () => sent,
    opens: () => opens,
  }
}

describe('transcript store', () => {
  let stub: ReturnType<typeof connectionStub>
  let store: TranscriptStore

  beforeEach(() => {
    stub = connectionStub()
    store = createTranscriptStore({
      connection: stub.connection,
      scheduleDraft: (flush) => flush(),
    })
  })

  it('starts empty', () => {
    expect(store.getTranscript()).toEqual([])
    expect(store.getDraft()).toBe('')
  })

  it('returns the same transcript reference until something recorded arrives', () => {
    store.connect(four)
    const before = store.getTranscript()

    store.getTranscript()
    expect(store.getTranscript()).toBe(before)

    stub.emit(1, { type: 'user.message', text: 'hello' })
    expect(store.getTranscript()).not.toBe(before)
  })

  it('leaves the transcript reference alone while tokens stream', () => {
    store.connect(four)
    stub.emit(1, { type: 'user.message', text: 'hello' })
    const before = store.getTranscript()

    stub.delta('a')
    stub.delta('b')

    expect(store.getTranscript()).toBe(before)
    expect(store.getDraft()).toBe('ab')
  })

  it('notifies only the draft when a token arrives', () => {
    store.connect(four)
    const onTranscript = vi.fn()
    const onDraft = vi.fn()
    store.subscribeTranscript(onTranscript)
    store.subscribeDraft(onDraft)

    stub.delta('a')

    expect(onDraft).toHaveBeenCalled()
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('coalesces a burst of tokens into one notification', () => {
    let flush: (() => void) | undefined
    const batched = createTranscriptStore({
      connection: stub.connection,
      scheduleDraft: (run) => {
        flush = run
      },
    })
    batched.connect(four)
    const onDraft = vi.fn()
    batched.subscribeDraft(onDraft)

    stub.delta('a')
    stub.delta('b')
    stub.delta('c')
    flush?.()

    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(batched.getDraft()).toBe('abc')
  })

  it('clears the draft when the finished message lands', () => {
    store.connect(four)
    stub.delta('hel')
    stub.delta('lo')

    stub.emit(1, { type: 'assistant.message', text: 'hello' })

    expect(store.getDraft()).toBe('')
    expect(store.getTranscript()).toHaveLength(1)
  })

  it('ignores an event it already holds, so a replay changes nothing', () => {
    store.connect(four)
    stub.emit(1, { type: 'user.message', text: 'hello' })
    const after = store.getTranscript()

    stub.emit(1, { type: 'user.message', text: 'hello' })

    expect(store.getTranscript()).toBe(after)
    expect(store.getTranscript()).toHaveLength(1)
  })

  it('opens one stream for the session it is already on', () => {
    store.connect(four)
    store.connect(four)

    expect(stub.opens()).toBe(1)
  })

  it('reconnects for the same ticket number in another workspace', () => {
    store.connect(four)
    store.connect({ workspaceId: 'w2', ticketId: '4' })

    expect(stub.opens()).toBe(2)
    expect(stub.closed()).toEqual([four])
  })

  it('closes the previous stream when the session changes', () => {
    store.connect(four)
    stub.emit(1, { type: 'user.message', text: 'hello' })

    store.connect(five)

    expect(stub.closed()).toEqual([four])
    expect(store.getTranscript()).toEqual([])
  })

  it('stops delivering after unsubscribing', () => {
    store.connect(four)
    const listener = vi.fn()
    const unsubscribe = store.subscribeTranscript(listener)
    unsubscribe()
    unsubscribe()

    stub.emit(1, { type: 'user.message', text: 'hello' })

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps what it received when it disconnects', () => {
    store.connect(four)
    stub.emit(1, { type: 'user.message', text: 'hello' })

    store.disconnect()
    store.disconnect()

    expect(store.getTranscript()).toHaveLength(1)
    expect(stub.closed()).toEqual([four])
  })

  it('sends a message, an answer and an interrupt as commands', async () => {
    store.connect(four)

    await store.send('hello')
    await store.answer('r1', { decision: 'allow' })
    await store.interrupt()

    expect(stub.sent()).toEqual([
      { command: 'message', text: 'hello' },
      { command: 'permission', requestId: 'r1', decision: { decision: 'allow' } },
      { command: 'interrupt' },
    ])
  })

  it('does nothing when there is no ticket to send to', async () => {
    await store.send('hello')

    expect(stub.sent()).toEqual([])
  })

  it('keeps the transcript after a fatal stream failure', () => {
    store.connect(four)
    stub.emit(1, { type: 'session.failed', code: 'auth_required', message: 'run claude once' })
    stub.fatal()

    expect(store.getTranscript()).toHaveLength(1)
  })
})
