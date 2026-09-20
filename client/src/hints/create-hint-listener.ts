import type { ArtifactHint, TicketId } from '@keel-web/protocol'
import type { CreateHintListener, HintListener } from './types.ts'

export const createHintListener: CreateHintListener = ({ workspaceId }): HintListener => {
  let stream: EventSource | undefined
  let listening: TicketId | undefined

  function close(): void {
    stream?.close()
    stream = undefined
    listening = undefined
  }

  return {
    listen(ticketId, onHint) {
      if (ticketId === listening) return
      close()
      if (ticketId === undefined) return

      listening = ticketId
      stream = new EventSource(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/tickets/${encodeURIComponent(ticketId)}/hints`,
      )

      stream.addEventListener('artifact.hint', (message) => {
        // A hint says look at this now. A tab nobody is looking at cannot,
        // and moving it behind the developer's back would be worse than
        // letting the hint go.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        try {
          onHint(JSON.parse((message as MessageEvent<string>).data) as ArtifactHint)
        } catch {
          // A line we cannot read is one hint lost, not a broken stream.
        }
      })
    },

    dispose: close,
  }
}
