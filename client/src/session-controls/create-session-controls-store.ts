import type { SessionControls, SessionKey, SessionSettingsChange } from '@keel-web/protocol'
import type { Connection } from '../connection/types.ts'
import type { ChangeResult, SessionControlsStore, Unsubscribe } from './types.ts'

export interface SessionControlsStoreOptions {
  connection: Connection
}

function sameSession(one: SessionKey, other: SessionKey): boolean {
  return one.workspaceId === other.workspaceId && one.ticketId === other.ticketId
}

export function createSessionControlsStore(
  options: SessionControlsStoreOptions,
): SessionControlsStore {
  const { connection } = options
  const listeners = new Set<() => void>()

  let key: SessionKey | undefined
  let controls: SessionControls | undefined

  function notify(): void {
    for (const listener of listeners) listener()
  }

  return {
    getControls() {
      return controls
    },

    subscribe(listener): Unsubscribe {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    take(message) {
      if (key === undefined || !sameSession(key, message)) return
      controls = message.controls
      notify()
    },

    pointAt(next) {
      if (key !== undefined && sameSession(key, next)) return
      key = next
      controls = undefined
      notify()
    },

    async change(change: SessionSettingsChange): Promise<ChangeResult> {
      if (key === undefined) return 'no_session'
      const result = await connection.send(key, { command: 'settings', change })
      if (result === 'accepted') return 'accepted'
      // A change the wire contract does not allow never leaves here, so a
      // server that calls one malformed is refusing it by a different name.
      return result === 'no_session' ? 'no_session' : 'refused'
    },
  }
}
