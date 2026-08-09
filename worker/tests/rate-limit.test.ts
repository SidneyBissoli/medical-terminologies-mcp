import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT } from "../src/config.js";
import { _resetRateLimit, checkRateLimit, TokenBucket } from "../src/rate-limit.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-06T12:00:00Z"));
  _resetRateLimit();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TokenBucket", () => {
  it("permite até o burst e depois bloqueia", () => {
    const bucket = new TokenBucket(3, 1);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("repõe tokens com o tempo", () => {
    const bucket = new TokenBucket(2, 1); // 1 token/s
    bucket.tryConsume(2);
    expect(bucket.tryConsume()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(bucket.tryConsume()).toBe(true);
  });

  it("retryAfterSeconds > 0 quando esgotado, 0 quando há token", () => {
    const bucket = new TokenBucket(1, 0.5); // repõe 1 token a cada 2s
    expect(bucket.retryAfterSeconds()).toBe(0);
    bucket.tryConsume();
    expect(bucket.retryAfterSeconds()).toBeGreaterThan(0);
    expect(bucket.retryAfterSeconds()).toBeLessThanOrEqual(2);
  });
});

describe("checkRateLimit", () => {
  it("bloqueia após o burst configurado e informa Retry-After", () => {
    for (let i = 0; i < RATE_LIMIT.clientBurst; i++) {
      expect(checkRateLimit("1.2.3.4").allowed).toBe(true);
    }
    const blocked = checkRateLimit("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterS).toBeGreaterThanOrEqual(1);
  });

  it("clientes distintos têm buckets independentes", () => {
    for (let i = 0; i < RATE_LIMIT.clientBurst; i++) checkRateLimit("1.1.1.1");
    expect(checkRateLimit("1.1.1.1").allowed).toBe(false);
    expect(checkRateLimit("2.2.2.2").allowed).toBe(true);
  });
});
