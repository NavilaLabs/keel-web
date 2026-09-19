import pino from 'pino'
import type { CreateLogger } from './types.js'

const redactedHeaderNames = ['authorization', 'cookie', 'set-cookie']
const redactedPaths = redactedHeaderNames.flatMap((name) => [`["${name}"]`, `headers["${name}"]`])

export const createLogger: CreateLogger = ({ level, format }) =>
  pino({
    level,
    redact: { paths: redactedPaths, censor: '[Redacted]' },
    transport: format === 'pretty' ? { target: 'pino-pretty' } : undefined,
  })
