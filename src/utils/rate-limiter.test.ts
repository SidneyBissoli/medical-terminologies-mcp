import { describe, it, expect } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  describe('tryAcquire (non-blocking)', () => {
    it('succeeds while tokens are available', () => {
      const rl = new RateLimiter({ maxTokens: 3, refillRate: 1 });
      expect(rl.tryAcquire()).toBe(true);
      expect(rl.tryAcquire()).toBe(true);
      expect(rl.tryAcquire()).toBe(true);
    });

    it('fails when bucket is empty', () => {
      const rl = new RateLimiter({ maxTokens: 2, refillRate: 0.0001 });
      expect(rl.tryAcquire()).toBe(true);
      expect(rl.tryAcquire()).toBe(true);
      expect(rl.tryAcquire()).toBe(false);
    });

    it('starts with initialTokens when supplied', () => {
      const rl = new RateLimiter({ maxTokens: 5, refillRate: 1, initialTokens: 1 });
      expect(rl.tryAcquire()).toBe(true);
      expect(rl.tryAcquire()).toBe(false);
    });
  });

  describe('acquire (blocking)', () => {
    it('resolves immediately when a token is free', async () => {
      const rl = new RateLimiter({ maxTokens: 2, refillRate: 1 });
      const start = Date.now();
      await rl.acquire();
      // Should be near-instant; allow generous slack for CI
      expect(Date.now() - start).toBeLessThan(50);
    });

    it('queues when bucket empty and resolves after refill', async () => {
      // 100 tokens/sec → ~10ms to refill one
      const rl = new RateLimiter({ maxTokens: 1, refillRate: 100 });
      await rl.acquire();
      expect(rl.getAvailableTokens()).toBeLessThan(1);

      const start = Date.now();
      await rl.acquire();
      const elapsed = Date.now() - start;
      // Should have waited ~10ms; bound loosely so timing flake doesn't fail tests
      expect(elapsed).toBeGreaterThanOrEqual(5);
      expect(elapsed).toBeLessThan(200);
    });

    it('processes parallel acquires in submission order', async () => {
      const rl = new RateLimiter({ maxTokens: 1, refillRate: 200 });
      // Drain initial token
      await rl.acquire();
      const order: number[] = [];
      const tasks = [0, 1, 2].map((i) =>
        rl.acquire().then(() => {
          order.push(i);
        }),
      );
      await Promise.all(tasks);
      expect(order).toEqual([0, 1, 2]);
    });
  });

  describe('observability', () => {
    it('reports queue length while waiters are pending', async () => {
      const rl = new RateLimiter({ maxTokens: 1, refillRate: 50 });
      await rl.acquire();
      const p1 = rl.acquire();
      const p2 = rl.acquire();
      expect(rl.getQueueLength()).toBeGreaterThan(0);
      await Promise.all([p1, p2]);
      expect(rl.getQueueLength()).toBe(0);
    });

    it('reset drains queue and refills bucket', async () => {
      const rl = new RateLimiter({ maxTokens: 1, refillRate: 1 });
      await rl.acquire();
      const queued = rl.acquire();
      rl.reset();
      await queued; // resolves because reset releases all queued waiters
      expect(rl.getAvailableTokens()).toBeGreaterThanOrEqual(1);
    });
  });
});
