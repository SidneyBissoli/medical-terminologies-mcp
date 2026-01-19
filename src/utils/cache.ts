import NodeCache from 'node-cache';
import { createLogger } from './logger.js';

const log = createLogger('cache');

/**
 * Default TTL values for different types of cached data (in seconds)
 */
export const DEFAULT_TTL = {
  /** Static data like terminology chapters - 24 hours */
  STATIC: 86400,
  /** Semi-static data like code lookups - 1 hour */
  LOOKUP: 3600,
  /** Search results - 10 minutes */
  SEARCH: 600,
  /** OAuth tokens - 50 minutes (tokens expire in 60) */
  TOKEN: 3000,
} as const;

/**
 * Cache key prefixes for different terminologies
 */
export const CACHE_PREFIX = {
  ICD11: 'icd11',
  LOINC: 'loinc',
  RXNORM: 'rxnorm',
  MESH: 'mesh',
  SNOMED: 'snomed',
  TOKEN: 'token',
} as const;

/**
 * Generic cache wrapper with support for different TTL values
 * Uses node-cache under the hood for in-memory caching
 */
export class CacheManager {
  private cache: NodeCache;

  /**
   * Creates a new CacheManager instance
   * @param checkPeriod - Interval in seconds to check for expired keys (default: 120)
   */
  constructor(checkPeriod: number = 120) {
    this.cache = new NodeCache({
      checkperiod: checkPeriod,
      useClones: false,
    });
  }

  /**
   * Generates a cache key with prefix
   * @param prefix - Cache key prefix (terminology identifier)
   * @param key - Unique key for the data
   * @returns Formatted cache key
   */
  private generateKey(prefix: string, key: string): string {
    return `${prefix}:${key}`;
  }

  /**
   * Stores a value in the cache
   * @param prefix - Cache key prefix
   * @param key - Unique key for the data
   * @param value - Value to cache
   * @param ttl - Time to live in seconds (default: LOOKUP TTL)
   * @returns true if successful
   */
  set<T>(prefix: string, key: string, value: T, ttl: number = DEFAULT_TTL.LOOKUP): boolean {
    const cacheKey = this.generateKey(prefix, key);
    return this.cache.set(cacheKey, value, ttl);
  }

  /**
   * Retrieves a value from the cache
   * @param prefix - Cache key prefix
   * @param key - Unique key for the data
   * @returns Cached value or undefined if not found/expired
   */
  get<T>(prefix: string, key: string): T | undefined {
    const cacheKey = this.generateKey(prefix, key);
    return this.cache.get<T>(cacheKey);
  }

  /**
   * Checks if a key exists in the cache
   * @param prefix - Cache key prefix
   * @param key - Unique key for the data
   * @returns true if key exists and is not expired
   */
  has(prefix: string, key: string): boolean {
    const cacheKey = this.generateKey(prefix, key);
    return this.cache.has(cacheKey);
  }

  /**
   * Deletes a value from the cache
   * @param prefix - Cache key prefix
   * @param key - Unique key for the data
   * @returns Number of deleted entries
   */
  delete(prefix: string, key: string): number {
    const cacheKey = this.generateKey(prefix, key);
    return this.cache.del(cacheKey);
  }

  /**
   * Deletes all entries with a specific prefix
   * @param prefix - Cache key prefix to clear
   * @returns Number of deleted entries
   */
  clearPrefix(prefix: string): number {
    const keys = this.cache.keys().filter(k => k.startsWith(`${prefix}:`));
    return this.cache.del(keys);
  }

  /**
   * Clears all cached data
   */
  flush(): void {
    this.cache.flushAll();
  }

  /**
   * Gets cache statistics
   * @returns Object with hits, misses, keys count, etc.
   */
  getStats(): NodeCache.Stats {
    return this.cache.getStats();
  }

  /**
   * Gets or sets a cached value using a factory function
   * If the value is not in cache, calls the factory and caches the result
   * @param prefix - Cache key prefix
   * @param key - Unique key for the data
   * @param factory - Async function to generate the value if not cached
   * @param ttl - Time to live in seconds
   * @returns Cached or newly generated value
   */
  async getOrSet<T>(
    prefix: string,
    key: string,
    factory: () => Promise<T>,
    ttl: number = DEFAULT_TTL.LOOKUP
  ): Promise<T> {
    const cacheKey = this.generateKey(prefix, key);
    const cached = this.get<T>(prefix, key);
    if (cached !== undefined) {
      log.debug({ key: cacheKey }, 'Cache hit');
      return cached;
    }

    log.debug({ key: cacheKey }, 'Cache miss');
    const value = await factory();
    this.set(prefix, key, value, ttl);
    return value;
  }
}

/** Singleton cache instance for the application */
export const cache = new CacheManager();
