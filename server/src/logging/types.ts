import type { MiddlewareHandler } from 'hono'

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'

export type LogFormat = 'pretty' | 'json'

export interface LogConfig {
  level: LogLevel
  format: LogFormat
}

/**
 * Reads `LOG_LEVEL` (default `info`) and derives the format: `json` when
 * `NODE_ENV` is `production`, otherwise `pretty`.
 *
 * Throws an `Error` naming the variable and the accepted levels when
 * `LOG_LEVEL` is invalid, so a typo fails at startup. Has no side effects.
 */
export type LoadLogConfig = (environment: Record<string, string | undefined>) => LogConfig

/**
 * Structurally compatible with the pino logger, without exposing pino.
 * Log methods never throw and never block. `child` returns a new logger with
 * the bindings added to every line and leaves the parent unchanged.
 */
export interface Logger {
  fatal(message: string): void
  fatal(fields: object, message?: string): void
  error(message: string): void
  error(fields: object, message?: string): void
  warn(message: string): void
  warn(fields: object, message?: string): void
  info(message: string): void
  info(fields: object, message?: string): void
  debug(message: string): void
  debug(fields: object, message?: string): void
  trace(message: string): void
  trace(fields: object, message?: string): void
  child(bindings: Record<string, unknown>): Logger
}

/**
 * `json` writes one JSON object per line to stdout, `pretty` writes coloured
 * lines to stdout. Nothing is written to a file. As a backstop, the keys
 * `authorization`, `cookie` and `set-cookie` (lowercase, top level or under
 * `headers`) are replaced with `[Redacted]`.
 *
 * Never throws for a valid config. Every call returns an independent logger.
 */
export type CreateLogger = (config: LogConfig) => Logger

export interface LoggerVariables {
  /** Child logger bound to `reqId` of the current request. */
  logger: Logger
  requestId: string
}

/**
 * Sets `requestId` and `logger` on the context and returns the id in the
 * `X-Request-Id` response header. An incoming `X-Request-Id` of at most 255
 * characters is reused, otherwise a UUID is generated.
 *
 * Logs exactly one line per request: message `request completed` with the
 * fields `reqId`, `method`, `path` (without query string), `status` and
 * `durationMs`. The level is `info` below 400, `warn` for 4xx, `error` for
 * 5xx. Headers, query string and bodies are never logged. For streamed
 * responses `durationMs` ends when the response headers are ready.
 *
 * Never throws and never swallows errors of later handlers. Not idempotent:
 * mounting it twice logs every request twice.
 */
export type CreateRequestLogger = (
  logger: Logger,
) => MiddlewareHandler<{ Variables: LoggerVariables }>
