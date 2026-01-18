/**
 * Configuration options for the rate limiter
 */
export interface RateLimiterOptions {
  /** Maximum number of tokens (requests) allowed in the bucket */
  maxTokens: number;
  /** Number of tokens to refill per second */
  refillRate: number;
  /** Initial number of tokens (default: maxTokens) */
  initialTokens?: number;
}

/**
 * Token bucket rate limiter implementation
 *
 * Uses the token bucket algorithm to control request rate:
 * - Bucket starts with a number of tokens
 * - Each request consumes one token
 * - Tokens are refilled at a constant rate
 * - If no tokens available, request must wait
 *
 * @example
 * ```typescript
 * // Allow 10 requests per second
 * const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10 });
 *
 * // Before each request
 * await limiter.acquire();
 * await makeApiCall();
 * ```
 */
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;
  private queue: Array<() => void>;

  /**
   * Creates a new RateLimiter instance
   * @param options - Rate limiter configuration
   */
  constructor(options: RateLimiterOptions) {
    this.maxTokens = options.maxTokens;
    this.refillRate = options.refillRate;
    this.tokens = options.initialTokens ?? options.maxTokens;
    this.lastRefill = Date.now();
    this.queue = [];
  }

  /**
   * Refills tokens based on elapsed time since last refill
   */
  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsedSeconds * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Calculates wait time in milliseconds until a token becomes available
   * @returns Wait time in milliseconds
   */
  private getWaitTime(): number {
    if (this.tokens >= 1) {
      return 0;
    }
    const tokensNeeded = 1 - this.tokens;
    return (tokensNeeded / this.refillRate) * 1000;
  }

  /**
   * Processes the next item in the queue if tokens are available
   */
  private processQueue(): void {
    if (this.queue.length === 0) {
      return;
    }

    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      const resolve = this.queue.shift();
      if (resolve) {
        resolve();
      }

      // Continue processing queue if more items and tokens
      if (this.queue.length > 0) {
        this.scheduleQueueProcessing();
      }
    } else {
      // Schedule next check when a token should be available
      this.scheduleQueueProcessing();
    }
  }

  /**
   * Schedules queue processing for when a token becomes available
   */
  private scheduleQueueProcessing(): void {
    const waitTime = this.getWaitTime();
    setTimeout(() => this.processQueue(), Math.max(1, Math.ceil(waitTime)));
  }

  /**
   * Acquires a token, waiting if necessary
   *
   * @returns Promise that resolves when a token is acquired
   *
   * @example
   * ```typescript
   * await limiter.acquire();
   * // Token acquired, safe to make request
   * ```
   */
  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Queue this request
    return new Promise<void>(resolve => {
      this.queue.push(resolve);

      // Start processing queue if this is the first item
      if (this.queue.length === 1) {
        this.scheduleQueueProcessing();
      }
    });
  }

  /**
   * Attempts to acquire a token without waiting
   *
   * @returns true if token was acquired, false otherwise
   *
   * @example
   * ```typescript
   * if (limiter.tryAcquire()) {
   *   // Token acquired
   *   await makeApiCall();
   * } else {
   *   // Rate limited, handle accordingly
   * }
   * ```
   */
  tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Gets the current number of available tokens
   * @returns Number of available tokens (may be fractional)
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Gets the current queue length
   * @returns Number of requests waiting for tokens
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Resets the rate limiter to initial state
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    // Resolve all queued requests
    while (this.queue.length > 0) {
      const resolve = this.queue.shift();
      if (resolve) {
        resolve();
      }
    }
  }
}

/**
 * Pre-configured rate limiters for each API
 */
export const rateLimiters = {
  /** WHO ICD-11 API - conservative limit (5 req/s) */
  who: new RateLimiter({ maxTokens: 5, refillRate: 5 }),

  /** NLM APIs (LOINC, MeSH) - courteous limit (10 req/s) */
  nlm: new RateLimiter({ maxTokens: 10, refillRate: 10 }),

  /** RxNorm API - documented limit (20 req/s) */
  rxnorm: new RateLimiter({ maxTokens: 20, refillRate: 20 }),

  /** SNOMED Snowstorm - conservative limit (10 req/s) */
  snomed: new RateLimiter({ maxTokens: 10, refillRate: 10 }),
};
