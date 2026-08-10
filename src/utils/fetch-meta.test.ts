import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CacheManager } from './cache.js';
import { cacheMetaFor, runWithFetchMeta } from './fetch-meta.js';

/**
 * The provenance contract's cache rule: `retrieved_at` is the REAL instant
 * of the upstream extraction — a hit must preserve the ORIGINAL fetch
 * instant, and `served_from_cache` must say which path served the value.
 */
describe('fetch-meta collector × cache', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a cache hit preserves the original fetch instant and reports served_from_cache', async () => {
    vi.setSystemTime(new Date('2026-08-09T12:00:00Z'));
    await runWithFetchMeta(async () => {
      await cache.getOrSet('icd11', 'k', async () => 'fresh', 3600);
      const fresh = cacheMetaFor(['icd11']);
      expect(fresh.servedFromCache).toBe(false);
      expect(fresh.retrievedAt.toISOString()).toBe('2026-08-09T12:00:00.000Z');
    });

    vi.setSystemTime(new Date('2026-08-09T12:30:00Z'));
    await runWithFetchMeta(async () => {
      const value = await cache.getOrSet('icd11', 'k', async () => 'never called', 3600);
      expect(value).toBe('fresh');
      const hit = cacheMetaFor(['icd11']);
      expect(hit.servedFromCache).toBe(true);
      // The legally relevant extraction date: the ORIGINAL fetch, not now.
      expect(hit.retrievedAt.toISOString()).toBe('2026-08-09T12:00:00.000Z');
    });
  });

  it('aggregation is per prefix — the OAuth token prefix never leaks into a data block', async () => {
    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'));
    cache.set('token', 'oauth', 'tok', 3000);
    vi.setSystemTime(new Date('2026-08-09T11:00:00Z'));
    await runWithFetchMeta(async () => {
      cache.get('token', 'oauth'); // token hit (infra, not data)
      await cache.getOrSet('mesh', 'a', async () => 1, 3600); // fresh data
      const meta = cacheMetaFor(['mesh']);
      expect(meta.servedFromCache).toBe(false);
      expect(meta.retrievedAt.toISOString()).toBe('2026-08-09T11:00:00.000Z');
    });
  });

  it('mixed hit + fresh within one call reports servedFromCache=false and the OLDEST instant', async () => {
    vi.setSystemTime(new Date('2026-08-09T09:00:00Z'));
    await runWithFetchMeta(() => cache.getOrSet('mesh', 'old', async () => 'v', 86400));

    vi.setSystemTime(new Date('2026-08-09T10:00:00Z'));
    await runWithFetchMeta(async () => {
      await cache.getOrSet('mesh', 'old', async () => 'never', 86400); // hit (09:00)
      await cache.getOrSet('mesh', 'new', async () => 'v2', 86400); // fresh (10:00)
      const meta = cacheMetaFor(['mesh']);
      expect(meta.servedFromCache).toBe(false);
      expect(meta.retrievedAt.toISOString()).toBe('2026-08-09T09:00:00.000Z');
    });
  });

  it('without a collector (or without accesses) the meta degrades to now/null', async () => {
    const outside = cacheMetaFor(['icd11']);
    expect(outside.servedFromCache).toBeNull();

    await runWithFetchMeta(async () => {
      const bundled = cacheMetaFor([]); // bundled datasets: no cache prefixes
      expect(bundled.servedFromCache).toBeNull();
    });
  });

  it('getOrSetWithMeta exposes the same metadata directly to callers', async () => {
    vi.setSystemTime(new Date('2026-08-09T08:00:00Z'));
    const first = await cache.getOrSetWithMeta('loinc', 'k', async () => 42, 3600);
    expect(first).toMatchObject({ value: 42, servedFromCache: false });

    vi.setSystemTime(new Date('2026-08-09T08:45:00Z'));
    const second = await cache.getOrSetWithMeta('loinc', 'k', async () => 99, 3600);
    expect(second.value).toBe(42);
    expect(second.servedFromCache).toBe(true);
    expect(second.retrievedAt.toISOString()).toBe('2026-08-09T08:00:00.000Z');
  });
});
