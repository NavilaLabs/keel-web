import type { PermissionDecision, ServerEvent, TicketId } from '@keel-web/protocol'
import type { CloseStream, Connection } from '../connection/types.ts'
import { fold } from './fold.ts'
import type { RenderItem, TranscriptStore, Unsubscribe } from './types.ts'

export interface TranscriptStoreOptions {
  connection: Connection
  /**
   * Batches delta notifications.
   *
   * Tokens arrive far faster than a screen refreshes, so without this a
   * hundred tokens a second become a hundred renders.
   */
  scheduleDraft?: (flush: () => void) => void
}

const noItems: readonly RenderItem[] = []

function defaultSchedule(flush: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush)
  else queueMicrotask(flush)
}

export function createTranscriptStore(options: TranscriptStoreOptions): TranscriptStore {
  const { connection } = options
  const scheduleDraft = options.scheduleDraft ?? defaultSchedule

  const transcriptListeners = new Set<() => void>()
  const draftListeners = new Set<() => void>()

  let ticketId: TicketId | undefined
  let close: CloseStream | undefined
  let events: ServerEvent[] = []
  let highestSeq = 0
  let items: readonly RenderItem[] = noItems
  let draft = ''
  let draftScheduled = false

  function notify(listeners: Set<() => void>): void {
    for (const listener of listeners) listener()
  }

  function scheduleDraftNotification(): void {
    if (draftScheduled) return
    draftScheduled = true
    scheduleDraft(() => {
      draftScheduled = false
      notify(draftListeners)
    })
  }

  function receive(event: ServerEvent): void {
    // A replay after a reconnect can repeat what is already held. Ignoring it
    // here is what lets the caller treat replayed and live events alike.
    if (event.seq <= highestSeq) return
    highestSeq = event.seq
    events = [...events, event]
    items = fold(events)

    if (event.type === 'assistant.message' && draft !== '') {
      draft = ''
      scheduleDraftNotification()
    }
    notify(transcriptListeners)
  }

  function reset(): void {
    close?.()
    close = undefined
    events = []
    highestSeq = 0
    items = noItems
    draft = ''
  }

  async function command(send: () => Promise<unknown>): Promise<void> {
    if (ticketId === undefined) return
    await send()
  }

  return {
    connect(next) {
      if (ticketId === next && close !== undefined) return
      reset()
      ticketId = next
      notify(transcriptListeners)
      notify(draftListeners)

      close = connection.open(next, highestSeq, {
        onEvent: receive,
        onDelta: (delta) => {
          draft += delta.text
          scheduleDraftNotification()
        },
        onFatal: () => {
          close = undefined
        },
      })
    },

    disconnect() {
      close?.()
      close = undefined
    },

    getTranscript() {
      return items
    },

    getDraft() {
      return draft
    },

    subscribeTranscript(listener): Unsubscribe {
      transcriptListeners.add(listener)
      return () => {
        transcriptListeners.delete(listener)
      }
    },

    subscribeDraft(listener): Unsubscribe {
      draftListeners.add(listener)
      return () => {
        draftListeners.delete(listener)
      }
    },

    send(text) {
      return command(() => connection.send(ticketId as TicketId, { command: 'message', text }))
    },

    answer(requestId, decision: PermissionDecision) {
      return command(() =>
        connection.send(ticketId as TicketId, { command: 'permission', requestId, decision }),
      )
    },

    interrupt() {
      return command(() => connection.send(ticketId as TicketId, { command: 'interrupt' }))
    },
  }
}
