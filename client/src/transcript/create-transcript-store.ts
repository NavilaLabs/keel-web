import type { PermissionDecision, ServerEvent, SessionKey } from '@keel-web/protocol'
import type { CloseStream, Connection } from '../connection/types.ts'
import type { SessionControlsStore } from '../session-controls/types.ts'
import { fold } from './fold.ts'
import type { RenderItem, TranscriptStore, Unsubscribe } from './types.ts'

export interface TranscriptStoreOptions {
  connection: Connection
  /**
   * Where what the session runs with is passed on to.
   *
   * There is one stream per session and this store owns it, so the controls
   * arrive here and belong somewhere else. Left out, they are dropped, which
   * is what a test that only cares about the transcript wants.
   */
  controls?: Pick<SessionControlsStore, 'take' | 'pointAt'>
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

  let key: SessionKey | undefined
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

  async function command(send: (key: SessionKey) => Promise<unknown>): Promise<void> {
    if (key === undefined) return
    await send(key)
  }

  return {
    connect(next) {
      const same =
        key !== undefined && key.workspaceId === next.workspaceId && key.ticketId === next.ticketId
      if (same && close !== undefined) return
      reset()
      key = next
      options.controls?.pointAt(next)
      notify(transcriptListeners)
      notify(draftListeners)

      close = connection.open(next, highestSeq, {
        onEvent: receive,
        onDelta: (delta) => {
          draft += delta.text
          scheduleDraftNotification()
        },
        onControls: (message) => {
          options.controls?.take(message)
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
      return command((current) => connection.send(current, { command: 'message', text }))
    },

    answer(requestId, decision: PermissionDecision) {
      return command((current) =>
        connection.send(current, { command: 'permission', requestId, decision }),
      )
    },

    interrupt() {
      return command((current) => connection.send(current, { command: 'interrupt' }))
    },
  }
}
