// Load .env before reading LOG_LEVEL so the configured level applies even when
// this module is the first one imported. (env.ts validates the rest of the env;
// the logger only needs LOG_LEVEL, read directly to avoid a logger<->env cycle.)
import 'dotenv/config';
import pino, { type Logger, type LoggerOptions } from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

const options: LoggerOptions = {
  level,
  // Belt-and-suspenders: even though request serializers strip headers, never
  // let the API key or auth headers reach the logs if anything logs them.
  redact: {
    paths: ['req.headers["x-api-key"]', 'req.headers.authorization'],
    remove: true,
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

/** Shared structured (JSON) logger for the whole service. */
export const logger = pino(options);

/**
 * Returns the per-request child logger attached by pino-http (carries the
 * request id) when present, falling back to the shared logger. Typed loosely so
 * callers don't depend on the pino-http module augmentation.
 */
export function requestLogger(req: { log?: Logger }): Logger {
  return req.log ?? logger;
}
