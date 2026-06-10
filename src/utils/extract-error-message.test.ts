import { describe, it, expect } from 'vitest';
import { HttpError } from './http.js';
import { extractErrorMessage } from './extract-error-message.js';

function fakeHttpError(opts: {
  data?: unknown;
  message?: string;
}): HttpError {
  return new HttpError(opts.message ?? 'fetch failed', {
    status: opts.data !== undefined ? 500 : undefined,
    data: opts.data,
  });
}

describe('extractErrorMessage', () => {
  it('reads { message } JSON body (most REST APIs)', () => {
    const err = fakeHttpError({ data: { message: 'Resource not found' } });
    expect(extractErrorMessage(err)).toBe('Resource not found');
  });

  it('reads { error_description } (OAuth-style)', () => {
    const err = fakeHttpError({ data: { error_description: 'invalid_client' } });
    expect(extractErrorMessage(err)).toBe('invalid_client');
  });

  it('reads { error: { message } } nested', () => {
    const err = fakeHttpError({ data: { error: { message: 'Quota exceeded' } } });
    expect(extractErrorMessage(err)).toBe('Quota exceeded');
  });

  it('reads { error: "string" } shape', () => {
    const err = fakeHttpError({ data: { error: 'Bad request' } });
    expect(extractErrorMessage(err)).toBe('Bad request');
  });

  it('returns short string body verbatim', () => {
    const err = fakeHttpError({ data: 'Service Temporarily Unavailable' });
    expect(extractErrorMessage(err)).toBe('Service Temporarily Unavailable');
  });

  it('truncates string body longer than 500 chars with ellipsis', () => {
    const html = '<html>'.repeat(200);
    const result = extractErrorMessage(fakeHttpError({ data: html }));
    expect(result.length).toBe(501); // 500 chars + '…'
    expect(result.endsWith('…')).toBe(true);
  });

  it('falls back to error.message when no response data', () => {
    const err = fakeHttpError({ message: 'timeout of 30000ms exceeded' });
    expect(extractErrorMessage(err)).toBe('timeout of 30000ms exceeded');
  });

  it('falls back to error.message when data is empty object', () => {
    const err = fakeHttpError({ data: {}, message: 'Request failed with status code 500' });
    expect(extractErrorMessage(err)).toBe('Request failed with status code 500');
  });

  it('falls back when data has only irrelevant keys', () => {
    const err = fakeHttpError({
      data: { code: 42, timestamp: 'now' },
      message: 'unhelpful default',
    });
    expect(extractErrorMessage(err)).toBe('unhelpful default');
  });

  it('prefers message over error_description when both present', () => {
    const err = fakeHttpError({
      data: { message: 'Specific', error_description: 'Generic' },
    });
    expect(extractErrorMessage(err)).toBe('Specific');
  });

  it('ignores empty-string message and tries the next shape', () => {
    const err = fakeHttpError({
      data: { message: '', error_description: 'real reason' },
    });
    expect(extractErrorMessage(err)).toBe('real reason');
  });

  it('handles undefined data field on response gracefully', () => {
    const err = fakeHttpError({ message: 'Network Error' });
    expect(extractErrorMessage(err)).toBe('Network Error');
  });
});
