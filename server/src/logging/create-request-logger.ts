import { requestId } from 'hono/request-id'
import type { CreateRequestLogger } from './types.js'

export const createRequestLogger: CreateRequestLogger = (logger) => {
  const assignRequestId = requestId()

  return (context, next) =>
    assignRequestId(context, async () => {
      const startedAt = performance.now()
      const requestLogger = logger.child({ reqId: context.get('requestId') })
      context.set('logger', requestLogger)

      await next()

      // Hono has already turned a handler error into a response, so the status is final.
      const status = context.res.status
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
      requestLogger[level](
        {
          method: context.req.method,
          path: context.req.path,
          status,
          durationMs: Math.round(performance.now() - startedAt),
        },
        'request completed',
      )
    })
}
