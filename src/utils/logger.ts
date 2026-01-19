import pino from 'pino';

/**
 * Log level configuration
 * Uses LOG_LEVEL environment variable, defaults to 'info'
 */
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

/**
 * Check if running in development mode
 */
const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Pino transport configuration for development (pino-pretty)
 * In production, uses default JSON output
 */
const transport = isDevelopment
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

/**
 * Main logger instance
 * Configured with:
 * - LOG_LEVEL env var (default: info)
 * - pino-pretty in development
 * - JSON output in production
 */
export const logger = pino({
  level: LOG_LEVEL,
  transport,
  base: {
    service: 'medical-terminologies-mcp',
  },
});

/**
 * Creates a child logger for a specific component
 * @param component - Component name (e.g., 'who-client', 'icd11-tools')
 * @returns Child logger instance
 */
export function createLogger(component: string): pino.Logger {
  return logger.child({ component });
}

/**
 * Helper to measure and log operation duration
 * @param logger - Logger instance
 * @param operation - Operation name
 * @param fn - Async function to measure
 * @returns Result of the async function
 */
export async function withLogging<T>(
  loggerInstance: pino.Logger,
  operation: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>
): Promise<T> {
  const startTime = Date.now();
  loggerInstance.debug({ operation, ...meta }, `Starting ${operation}`);

  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    loggerInstance.info({ operation, durationMs: duration, ...meta }, `Completed ${operation}`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggerInstance.error(
      { operation, durationMs: duration, error: errorMessage, ...meta },
      `Failed ${operation}`
    );
    throw error;
  }
}

/**
 * Log levels available:
 * - trace: Most verbose, for detailed debugging
 * - debug: Development debugging
 * - info: General operational information
 * - warn: Warning conditions
 * - error: Error conditions
 * - fatal: System unusable
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// Re-export pino types for convenience
export type { Logger } from 'pino';
