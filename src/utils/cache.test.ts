import { describe, it, expect, beforeEach } from 'vitest';
import { CacheManager, CACHE_PREFIX, DEFAULT_TTL } from './cache.js';

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager();
  });

  describe('basic get/set', () => {
    it('returns undefined for unknown keys', () => {
      expect(cache.get(CACHE_PREFIX.ICD11, 'nope')).toBeUndefined();
    });

    it('returns the stored value after set', () => {
      cache.set(CACHE_PREFIX.ICD11, 'k', { code: 'BA00' });
      expect(cache.get(CACHE_PREFIX.ICD11, 'k')).toEqual({ code: 'BA00' });
    });

    it('namespaces keys by prefix — same key, different prefix', () => {
      cache.set(CACHE_PREFIX.ICD11, 'k', 'icd-value');
      cache.set(CACHE_PREFIX.LOINC, 'k', 'loinc-value');
      expect(cache.get(CACHE_PREFIX.ICD11, 'k')).toBe('icd-value');
      expect(cache.get(CACHE_PREFIX.LOINC, 'k')).toBe('loinc-value');
    });

    it('reports has() correctly', () => {
      expect(cache.has(CACHE_PREFIX.MESH, 'k')).toBe(false);
      cache.set(CACHE_PREFIX.MESH, 'k', 'v');
      expect(cache.has(CACHE_PREFIX.MESH, 'k')).toBe(true);
    });
  });

  describe('getOrSet', () => {
    it('calls factory once on miss and caches the result', async () => {
      let calls = 0;
      const factory = async () => {
        calls++;
        return 'v';
      };
      const a = await cache.getOrSet(CACHE_PREFIX.RXNORM, 'k', factory);
      const b = await cache.getOrSet(CACHE_PREFIX.RXNORM, 'k', factory);
      expect(a).toBe('v');
      expect(b).toBe('v');
      expect(calls).toBe(1);
    });

    it('does not catch factory errors (caller handles)', async () => {
      const boom = async () => {
        throw new Error('upstream fail');
      };
      await expect(cache.getOrSet(CACHE_PREFIX.RXNORM, 'k', boom)).rejects.toThrow(
        'upstream fail',
      );
      // Failed factory must not poison the cache
      expect(cache.has(CACHE_PREFIX.RXNORM, 'k')).toBe(false);
    });
  });

  describe('clearPrefix', () => {
    it('only clears keys under the given prefix', () => {
      cache.set(CACHE_PREFIX.ICD11, 'a', 1);
      cache.set(CACHE_PREFIX.ICD11, 'b', 2);
      cache.set(CACHE_PREFIX.LOINC, 'a', 3);

      cache.clearPrefix(CACHE_PREFIX.ICD11);

      expect(cache.get(CACHE_PREFIX.ICD11, 'a')).toBeUndefined();
      expect(cache.get(CACHE_PREFIX.ICD11, 'b')).toBeUndefined();
      expect(cache.get(CACHE_PREFIX.LOINC, 'a')).toBe(3);
    });
  });

  describe('TTL constants', () => {
    it('has sensible defaults', () => {
      // Smoke: STATIC > LOOKUP > SEARCH > 0 (TOKEN is its own scale)
      expect(DEFAULT_TTL.STATIC).toBeGreaterThan(DEFAULT_TTL.LOOKUP);
      expect(DEFAULT_TTL.LOOKUP).toBeGreaterThan(DEFAULT_TTL.SEARCH);
      expect(DEFAULT_TTL.SEARCH).toBeGreaterThan(0);
      expect(DEFAULT_TTL.TOKEN).toBeGreaterThan(0);
    });
  });
});
