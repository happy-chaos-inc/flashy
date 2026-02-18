/**
 * Production-safe logger
 *
 * In development: logs to console with emojis
 * In production: no-ops (silent)
 *
 * Usage:
 *   import { logger } from './lib/logger';
 *   logger.log('Hello');           // Regular log
 *   logger.info('Info message');   // Info
 *   logger.warn('Warning');        // Warning
 *   logger.error('Error');         // Error (always logs, even in prod)
 */

const isDev = process.env.NODE_ENV === 'development';

type LogFn = (...args: any[]) => void;

interface Logger {
  log: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
}

const noop: LogFn = () => {};

export const logger: Logger = {
  log: isDev ? console.log.bind(console) : noop,
  info: isDev ? console.info.bind(console) : noop,
  warn: isDev ? console.warn.bind(console) : noop,
  // Always log errors, even in production (for debugging critical issues)
  error: console.error.bind(console),
  debug: isDev ? console.debug.bind(console) : noop,
};

export default logger;
