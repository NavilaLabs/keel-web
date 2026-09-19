import type { ServerEvent, ServerEventBody, TicketId } from '@keel-web/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, StreamHandlers } from '../connection/types.ts'
import { createTranscriptStore } from './create-transcript-store.ts'
import type { TranscriptStore } from './types.ts'

function event(seq: number, body: ServerEventBody): ServerEvent {
  return { seq, ticketId: '4', ...body } as ServerEvent
}

function connectionStub() {
  let handlers: StreamHandlers | undefined
  const closed: TicketId[] = []
  const sent: unknown[] = []
  let opens = 0

  const connection: Connection = {
    open: (ticketId, _afterSeq, given) => {
      opens += 1
      handlers = given
      return () => closed.push(ticketId)
    },
    send: async (_ticketId, command) => {
      sent.push(command)
      return 'accepted'
    },
  }

  return {
    connection,
    emit: (seq: number, body: ServerEventBody) => handlers?.onEvent(event(seq, body)),
    delta: (text: string) => handlers?.onDelta({ type: 'assistant.delta', ticketId: '4', text }),
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
    store.connect('4')
    const before = store.getTranscript()

    store.getTranscript()
    expect(store.getTranscript()).toBe(before)

    stub.emit(1, { type: 'user.message', text: 'hello' })
    expect(store.getTranscript()).not.toBe(before)
  })

  it('leaves the transcript reference alone while tokens stream', () => {
    store.connect('4')
    stub.emit(1, { type: 'user.message', text: 'hello' })
    const before = store.getTranscript()

    stub.delta('a')
    stub.delta('b')

    expect(store.getTranscript()).toBe(before)
    expect(store.getDraft()).toBe('ab')
  })

  it('notifies only the draft when a token arrives', () => {
    store.connect('4')
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
    batched.connect('4')
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
    store.connect('4')
    stub.delta('hel')
    stub.delta('lo')

    stub.emit(1, { type: 'assistant.message', text: 'hello' })

    expect(store.getDraft()).toBe('')
    expect(store.getTranscript()).toHaveLength(1)
  })

  it('ignores an event it already holds, so a replay changes nothing', () => {
    store.connect('4')
    stub.emit(1, { type: 'user.message', text: 'hello' })
    const after = store.getTranscript()

    stub.emit(1, { type: 'user.message', text: 'hello' })

    expect(store.getTranscript()).toBe(after)
    expect(store.getTranscript()).toHaveLength(1)
  })

  it('opens one stream for the ticket it is already on', () => {
    store.connect('4')
    store.connect('4')

    expect(stub.opens()).toBe(1)
  })

  it('closes the previous stream when the ticket changes', () => {
    store.connect('4')
    stub.emit(1, { type: 'user.message', text: 'hello' })

    store.connect('5')

    expect(stub.closed()).toEqual(['4'])
    expect(store.getTranscript()).toEqual([])
  })

  it('stops delivering after unsubscribing', () => {
    store.connect('4')
    const listener = vi.fn()
    const unsubscribe = store.subscribeTranscript(listener)
    unsubscribe()
    unsubscribe()

    stub.emit(1, { type: 'user.message', text: 'hello' })

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps what it received when it disconnects', () => {
    store.connect('4')
    stub.emit(1, { type: 'user.message', text: 'hello' })

    store.disconnect()
    store.disconnect()

    expect(store.getTranscript()).toHaveLength(1)
    expect(stub.closed()).toEqual(['4'])
  })

  it('sends a message, an answer and an interrupt as commands', async () => {
    store.connect('4')

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
    store.connect('4')
    stub.emit(1, { type: 'session.failed', code: 'auth_required', message: 'run claude once' })
    stub.fatal()

    expect(store.getTranscript()).toHaveLength(1)
  })
})
