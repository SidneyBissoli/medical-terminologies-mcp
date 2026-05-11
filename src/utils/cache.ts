/**
 * In-memory cache with per-entry TTL, lazy expiration.
 *
 * Previously used `node-cache` (CJS, depends on `events`). That broke on
 * Cloudflare Workers because the bundled `__require('node:events')` shim
 * throws at runtime — Workers ESM doesn't support dynamic require. This
 * Map-backed implementation is platform-neutral (Node + Workers) and
 * removes the dep entirely. Same public API as before so callers don't
 * change.
 *
 * Expiration is lazy: entries linger in the Map past their TTL until the
 * next get/has/getOrSet touches them. We deliberately skip a background
 * setInterval sweep because Workers isolates may be short-lived (no point
 * scheduling cleanup) and Node memory pressure is dominated by the actual
 * cached bytes, not by stale slots. Stage 2 (PROGRESS.md Phase 11.9
 * follow-up) replaces this with Workers KV for cross-isolate sharing.
 */

interface CacheEntry<T> {
  value: T;
  /** Absolute epoch-ms when this entry expires, or null for never. */
  expiresAt: number | null;
}

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

export class CacheManager {
  private store = new Map<string, CacheEntry<unknown>>();

  private generateKey(prefix: string, key: string): string {
    return `${prefix}:${key}`;
  }

  /**
   * Returns the entry if present and not expired; otherwise deletes the
   * stale entry (if any) and returns undefined.
   */
  private liveEntry<T>(cacheKey: string): CacheEntry<T> | undefined {
    const entry = this.store.get(cacheKey) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(cacheKey);
      return undefined;
    }
    return entry;
  }

  set<T>(prefix: string, key: string, value: T, ttl: number = DEFAULT_TTL.LOOKUP): boolean {
    const cacheKey = this.generateKey(prefix, key);
    const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;
    this.store.set(cacheKey, { value, expiresAt });
    return true;
  }

  get<T>(prefix: string, key: string): T | undefined {
    const cacheKey = this.generateKey(prefix, key);
    return this.liveEntry<T>(cacheKey)?.value;
  }

  has(prefix: string, key: string): boolean {
    const cacheKey = this.generateKey(prefix, key);
    return this.liveEntry(cacheKey) !== undefined;
  }

  delete(prefix: string, key: string): number {
    const cacheKey = this.generateKey(prefix, key);
    return this.store.delete(cacheKey) ? 1 : 0;
  }

  clearPrefix(prefix: string): number {
    const needle = `${prefix}:`;
    let count = 0;
    for (const k of this.store.keys()) {
      if (k.startsWith(needle)) {
        this.store.delete(k);
        count++;
      }
    }
    return count;
  }

  flush(): void {
    this.store.clear();
  }

  /**
   * Best-effort stats — only returns key count; hit/miss counters are not
   * tracked (the previous node-cache impl exposed them but no caller
   * inside this project read them).
   */
  getStats(): { keys: number } {
    return { keys: this.store.size };
  }

  async getOrSet<T>(
    prefix: string,
    key: string,
    factory: () => Promise<T>,
    ttl: number = DEFAULT_TTL.LOOKUP,
  ): Promise<T> {
    const cached = this.get<T>(prefix, key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(prefix, key, value, ttl);
    return value;
  }
}

/** Singleton cache instance for the application */
export const cache = new CacheManager();
