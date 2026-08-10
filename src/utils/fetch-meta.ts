/**
 * Ambient collector of cache/fetch metadata for the provenance block
 * (portfolio contract v1.0).
 *
 * The contract requires `retrieved_at` to be the REAL instant of the
 * upstream extraction — a cache hit must report when the data was
 * originally fetched, not when the cached copy was served. In ibge-br-mcp
 * the tools own their cache keys, so they read the per-key metadata
 * directly; here the CLIENTS own the keys (handlers never see them), so
 * the metadata flows out-of-band instead: the cache layer records every
 * data access into an AsyncLocalStorage collector that the dispatcher
 * (`handle` in src/register.ts) opens per tool call, and the provenance
 * builder aggregates the accesses relevant to its source.
 *
 * AsyncLocalStorage is why this is race-free under concurrent tool calls
 * on both targets: Node has it natively and Cloudflare Workers implement
 * `node:async_hooks` under the `nodejs_compat` flag the Worker already
 * uses. When no collector is active (direct handler calls in tests), the
 * cache records nothing and `cacheMetaFor` falls back to "now / unknown".
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface CacheAccess {
  /** Cache prefix of the access (CACHE_PREFIX.* value, e.g. 'icd11'). */
  prefix: string;
  /** Epoch-ms when the entry's value was fetched from the upstream. */
  storedAtMs: number;
  /** true = served from cache; false = fetched fresh in this access. */
  servedFromCache: boolean;
}

export interface FetchMeta {
  /** Real upstream extraction instant (oldest contributing access). */
  retrievedAt: Date;
  /**
   * true only when every contributing access was a cache hit; false when
   * any fresh fetch happened; null when the server cannot distinguish
   * (no collector active, or no cache access — e.g. bundled datasets).
   */
  servedFromCache: boolean | null;
}

const collectorStorage = new AsyncLocalStorage<CacheAccess[]>();

/** Opens a fresh collector for the duration of `fn` (one per tool call). */
export function runWithFetchMeta<T>(fn: () => Promise<T>): Promise<T> {
  return collectorStorage.run([], fn);
}

/** Called by the cache layer on every data access; no-op without a collector. */
export function recordCacheAccess(access: CacheAccess): void {
  collectorStorage.getStore()?.push(access);
}

/**
 * Aggregates the accesses of the given cache prefixes into the meta the
 * provenance block needs. `retrievedAt` is the OLDEST contributing fetch
 * instant (the data is at least that old — the conservative extraction
 * date); `servedFromCache` is true only if the whole response came from
 * cache. The 'token' prefix is never passed in: the WHO OAuth token is
 * infrastructure, not data.
 */
export function cacheMetaFor(prefixes: readonly string[]): FetchMeta {
  const accesses = collectorStorage.getStore()?.filter((a) => prefixes.includes(a.prefix)) ?? [];
  if (accesses.length === 0) {
    return { retrievedAt: new Date(), servedFromCache: null };
  }
  const oldest = Math.min(...accesses.map((a) => a.storedAtMs));
  return {
    retrievedAt: new Date(oldest),
    servedFromCache: accesses.every((a) => a.servedFromCache),
  };
}
