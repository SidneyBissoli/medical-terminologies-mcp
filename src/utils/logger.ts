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
 * Create pino logger with stderr destination
 * MCP servers using stdio MUST log to stderr (stdout is used for JSON-RPC)
 */
function createPinoLogger(): pino.Logger {
  const baseOptions: pino.LoggerOptions = {
    level: LOG_LEVEL,
    base: {
      service: 'medical-terminologies-mcp',
    },
  };

  if (isDevelopment) {
    // In development, use pino-pretty transport with stderr
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          destination: 2, // stderr file descriptor
        },
      },
    });
  }

  // In production, output JSON to stderr
  return pino(baseOptions, pino.destination(2));
}

/**
 * Main logger instance
 * Configured with:
 * - LOG_LEVEL env var (default: info)
 * - pino-pretty in development
 * - JSON output in production
 * - Output to stderr (required for MCP stdio transport)
 */
export const logger = createPinoLogger();

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
 * @param loggerInstance - Logger instance
 * @param operation - Operation name
 * @param fn - Async function to measure
 * @param meta - Additional metadata to log
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
