import { describe, it, expect, vi } from 'vitest';
import { withRetry } from './retry.js';
import { HttpError } from './http.js';

function httpError(status: number, message = `HTTP ${status}`): HttpError {
  return new HttpError(message, { status });
}

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a retryable HTTP status, then succeeds', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { initialDelay: 1, maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a 400 (non-retryable)', async () => {
    const fn = vi.fn(async () => {
      throw httpError(400);
    });
    await expect(withRetry(fn, { initialDelay: 1, maxRetries: 3 })).rejects.toThrow(
      'HTTP 400',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws the last error after exhausting retries', async () => {
    const fn = vi.fn(async () => {
      throw httpError(503);
    });
    await expect(withRetry(fn, { initialDelay: 1, maxRetries: 2 })).rejects.toThrow(
      'HTTP 503',
    );
    // initial attempt + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries an HttpError with no status (request never completed)', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpError('timeout of 30000ms exceeded'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { initialDelay: 1, maxRetries: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on network error messages (ECONNRESET, ETIMEDOUT, ...)', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('connect ECONNRESET 1.2.3.4:443'))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, { initialDelay: 1, maxRetries: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honors a custom retryableStatusCodes list', async () => {
    // Make 418 retryable, 500 not
    const fn = vi.fn(async () => {
      throw httpError(500);
    });
    await expect(
      withRetry(fn, {
        initialDelay: 1,
        maxRetries: 3,
        retryableStatusCodes: [418],
      }),
    ).rejects.toThrow('HTTP 500');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('invokes onRetry callback for each retry attempt', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue('ok');

    await withRetry(fn, { initialDelay: 1, maxRetries: 2, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      1,
      expect.any(Error),
      expect.any(Number),
    );
  });
});
