import type { AssistantDelta, ClientCommand, ServerEvent, TicketId } from '@keel-web/protocol'
import type {
  CloseStream,
  Connection,
  CreateConnection,
  SendResult,
  StreamHandlers,
} from './types.ts'

/**
 * Every frame the server names.
 *
 * The server sends `event: <type>` for recorded events and for deltas, so
 * `onmessage` never fires and each name needs its own listener. Adding a type
 * to the protocol without adding it here is a compile error, by way of
 * `eventNameCheck` below.
 */
const eventNames = [
  'session.started',
  'user.message',
  'assistant.message',
  'assistant.thinking',
  'tool.started',
  'tool.completed',
  'permission.requested',
  'permission.resolved',
  'session.idle',
  'session.failed',
] as const

type EventNameCheck = Record<ServerEvent['type'], true>
const eventNameCheck: EventNameCheck = Object.fromEntries(
  eventNames.map((name) => [name, true]),
) as EventNameCheck
void eventNameCheck

function statusToResult(status: number): SendResult {
  if (status === 204) return 'accepted'
  if (status === 400) return 'malformed'
  if (status === 409) return 'not_held'
  return 'no_session'
}

export const createConnection: CreateConnection = (baseUrl: string): Connection => ({
  open(ticketId: TicketId, afterSeq: number, handlers: StreamHandlers): CloseStream {
    const source = new EventSource(`${baseUrl}/tickets/${encodeURIComponent(ticketId)}/events`)
    let closed = false

    const close: CloseStream = () => {
      if (closed) return
      closed = true
      source.close()
    }

    // The browser resumes from the last id it saw, so a client-side afterSeq
    // only matters for the very first connection of a fresh page.
    void afterSeq

    for (const name of eventNames) {
      source.addEventListener(name, (message) => {
        const event = JSON.parse((message as MessageEvent<string>).data) as ServerEvent
        if (event.type === 'session.failed') {
          // Attaching failed for good. The stream is about to end, and
          // EventSource would read that as a network error and reconnect for
          // ever, so it has to be closed here.
          if (event.code === 'auth_required' || event.code === 'startup_failed') {
            close()
            handlers.onFatal(event.code)
            return
          }
        }
        handlers.onEvent(event)
      })
    }

    source.addEventListener('assistant.delta', (message) => {
      handlers.onDelta(JSON.parse((message as MessageEvent<string>).data) as AssistantDelta)
    })

    return close
  },

  async send(ticketId: TicketId, command: ClientCommand): Promise<SendResult> {
    try {
      const response = await fetch(`${baseUrl}/tickets/${encodeURIComponent(ticketId)}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      })
      return statusToResult(response.status)
    } catch {
      // The browser cannot tell a dropped connection from a session that ended.
      return 'no_session'
    }
  },
})
