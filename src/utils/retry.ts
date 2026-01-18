import { AxiosError } from 'axios';

/**
 * Configuration options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in milliseconds between retries (default: 10000) */
  maxDelay?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** HTTP status codes that should trigger a retry (default: [408, 429, 500, 502, 503, 504]) */
  retryableStatusCodes?: number[];
  /** Whether to add jitter to the delay (default: true) */
  jitter?: boolean;
  /** Callback function called before each retry attempt */
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

/**
 * Default retry options
 */
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  jitter: true,
};

/**
 * Delays execution for a specified number of milliseconds
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculates the delay for a retry attempt with exponential backoff
 * @param attempt - Current attempt number (1-indexed)
 * @param options - Retry options
 * @returns Delay in milliseconds
 */
function calculateDelay(attempt: number, options: Required<Omit<RetryOptions, 'onRetry'>>): number {
  const exponentialDelay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt - 1);
  let delay = Math.min(exponentialDelay, options.maxDelay);

  if (options.jitter) {
    // Add random jitter of ±25%
    const jitterRange = delay * 0.25;
    delay = delay + (Math.random() * 2 - 1) * jitterRange;
  }

  return Math.floor(delay);
}

/**
 * Determines if an error is retryable based on its type and status code
 * @param error - The error to check
 * @param retryableStatusCodes - List of HTTP status codes that are retryable
 * @returns true if the error is retryable
 */
function isRetryableError(error: unknown, retryableStatusCodes: number[]): boolean {
  // Network errors are always retryable
  if (error instanceof Error) {
    if (error.message.includes('ECONNRESET') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('socket hang up')) {
      return true;
    }
  }

  // Check Axios errors
  if (isAxiosError(error)) {
    // Network error without response
    if (!error.response) {
      return true;
    }

    // Check if status code is retryable
    return retryableStatusCodes.includes(error.response.status);
  }

  return false;
}

/**
 * Type guard for Axios errors
 * @param error - Error to check
 * @returns true if error is an AxiosError
 */
function isAxiosError(error: unknown): error is AxiosError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'isAxiosError' in error &&
    (error as AxiosError).isAxiosError === true
  );
}

/**
 * Executes a function with automatic retry on failure using exponential backoff
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns Result of the function
 * @throws Last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => axios.get('https://api.example.com/data'),
 *   { maxRetries: 3, initialDelay: 1000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      const isLastAttempt = attempt > opts.maxRetries;
      const isRetryable = isRetryableError(error, opts.retryableStatusCodes);

      if (isLastAttempt || !isRetryable) {
        throw lastError;
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt, opts);

      // Call retry callback if provided
      if (options.onRetry) {
        options.onRetry(attempt, lastError, delay);
      }

      // Log to stderr for debugging
      process.stderr.write(
        `[retry] Attempt ${attempt} failed, retrying in ${delay}ms: ${lastError.message}\n`
      );

      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new Error('Retry failed');
}

/**
 * Creates a retryable version of an async function
 *
 * @param fn - Async function to wrap
 * @param options - Retry configuration options
 * @returns Wrapped function with automatic retry
 *
 * @example
 * ```typescript
 * const fetchData = retryable(
 *   async (id: string) => axios.get(`/api/data/${id}`),
 *   { maxRetries: 3 }
 * );
 *
 * const result = await fetchData('123');
 * ```
 */
export function retryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}
