import type { MiddlewareHandler } from 'hono'

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'

export type LogFormat = 'pretty' | 'json'

export interface LogConfig {
  level: LogLevel
  format: LogFormat
}

/**
 * Throws an `Error` when `LOG_LEVEL` is invalid. `LOG_LEVEL` defaults to `info`.
 * The format is `json` when `NODE_ENV` is `production`, otherwise `pretty`.
 */
export type LoadLogConfig = (environment: Record<string, string | undefined>) => LogConfig

/** Structurally compatible with the pino logger. Log methods never throw. */
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
 * Writes to stdout only. The keys `authorization`, `cookie` and `set-cookie`
 * (top level or under `headers`) are replaced with `[Redacted]`.
 */
export type CreateLogger = (config: LogConfig) => Logger

export interface LoggerVariables {
  logger: Logger
  requestId: string
}

/**
 * Logs one line per request: message `request completed` with the fields
 * `reqId`, `method`, `path` (without query string), `status` and `durationMs`.
 * The level is `info`, `warn` for 4xx and `error` for 5xx. Headers, query
 * string and bodies are never logged.
 *
 * An incoming `X-Request-Id` of at most 255 characters is reused, otherwise a
 * UUID is generated. The id is returned in the `X-Request-Id` response header.
 * Mounting the middleware twice logs every request twice.
 */
export type CreateRequestLogger = (
  logger: Logger,
) => MiddlewareHandler<{ Variables: LoggerVariables }>
