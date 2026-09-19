import type { LoadLogConfig, LogLevel } from './types.js'

const logLevels: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]

function isLogLevel(value: string): value is LogLevel {
  return (logLevels as readonly string[]).includes(value)
}

export const loadLogConfig: LoadLogConfig = (environment) => {
  const level = environment.LOG_LEVEL ?? 'info'
  if (!isLogLevel(level)) {
    throw new Error(`LOG_LEVEL must be one of ${logLevels.join(', ')}, got "${level}"`)
  }
  return { level, format: environment.NODE_ENV === 'production' ? 'json' : 'pretty' }
}
