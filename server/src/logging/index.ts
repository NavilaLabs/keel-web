import { loadLogConfig } from './config.js'
import { createLogger } from './create-logger.js'
import { createRequestLogger } from './create-request-logger.js'

export const logger = createLogger(loadLogConfig(process.env))
export const requestLogger = createRequestLogger(logger)

export type { Logger, LoggerVariables } from './types.js'
