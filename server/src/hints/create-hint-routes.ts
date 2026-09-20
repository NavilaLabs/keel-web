import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { LoggerVariables } from '../logging/types.js'
import type { CreateHintRoutes } from './types.js'

export const createHintRoutes: CreateHintRoutes = ({ hints, workspaces }) => {
  const routes = new Hono<{ Variables: LoggerVariables }>()

  routes.get('/workspaces/:workspaceId/tickets/:ticketId/hints', (context) => {
    const workspace = workspaces.find(context.req.param('workspaceId'))
    if (!workspace) {
      return context.json({ reason: 'That workspace is not one keel-web knows.' }, 404)
    }

    const ticketId = context.req.param('ticketId')
    const resume = Number(context.req.header('Last-Event-ID') ?? '')
    const after = Number.isFinite(resume) && resume >= 0 ? resume : undefined

    return streamSSE(context, async (stream) => {
      const pending: { id: string; data: string }[] = []
      let write: (() => void) | undefined

      const stop = hints.follow(
        workspace,
        ticketId,
        (read) => {
          // The reading position is the id, so a reconnect resumes by saying
          // where it stopped and nothing is ever delivered twice.
          pending.push({ id: String(read.offset), data: JSON.stringify(read.hint) })
          write?.()
        },
        after,
      )

      stream.onAbort(stop)

      try {
        while (!stream.closed && !stream.aborted) {
          const next = pending.shift()
          if (next === undefined) {
            await new Promise<void>((resolve) => {
              write = resolve
              setTimeout(resolve, 15_000)
            })
            write = undefined
            // Nothing arrived. A comment keeps the connection warm without
            // becoming an event the browser would resume from.
            if (pending.length === 0) await stream.writeSSE({ data: '', event: 'keep-alive' })
            continue
          }
          await stream.writeSSE({ event: 'artifact.hint', id: next.id, data: next.data })
        }
      } finally {
        stop()
      }
    })
  })

  return routes
}
