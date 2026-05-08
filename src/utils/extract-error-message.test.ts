import { describe, it, expect } from 'vitest';
import type { AxiosError } from 'axios';
import { extractErrorMessage } from './extract-error-message.js';

function fakeAxiosError(opts: {
  data?: unknown;
  message?: string;
}): AxiosError {
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: opts.message ?? 'Network Error',
    response: opts.data !== undefined ? ({ data: opts.data } as AxiosError['response']) : undefined,
  } as AxiosError;
}

describe('extractErrorMessage', () => {
  it('reads { message } JSON body (most REST APIs)', () => {
    const err = fakeAxiosError({ data: { message: 'Resource not found' } });
    expect(extractErrorMessage(err)).toBe('Resource not found');
  });

  it('reads { error_description } (OAuth-style)', () => {
    const err = fakeAxiosError({ data: { error_description: 'invalid_client' } });
    expect(extractErrorMessage(err)).toBe('invalid_client');
  });

  it('reads { error: { message } } nested', () => {
    const err = fakeAxiosError({ data: { error: { message: 'Quota exceeded' } } });
    expect(extractErrorMessage(err)).toBe('Quota exceeded');
  });

  it('reads { error: "string" } shape', () => {
    const err = fakeAxiosError({ data: { error: 'Bad request' } });
    expect(extractErrorMessage(err)).toBe('Bad request');
  });

  it('returns short string body verbatim', () => {
    const err = fakeAxiosError({ data: 'Service Temporarily Unavailable' });
    expect(extractErrorMessage(err)).toBe('Service Temporarily Unavailable');
  });

  it('truncates string body longer than 500 chars with ellipsis', () => {
    const html = '<html>'.repeat(200);
    const result = extractErrorMessage(fakeAxiosError({ data: html }));
    expect(result.length).toBe(501); // 500 chars + '…'
    expect(result.endsWith('…')).toBe(true);
  });

  it('falls back to error.message when no response data', () => {
    const err = fakeAxiosError({ message: 'timeout of 30000ms exceeded' });
    expect(extractErrorMessage(err)).toBe('timeout of 30000ms exceeded');
  });

  it('falls back to error.message when data is empty object', () => {
    const err = fakeAxiosError({ data: {}, message: 'Request failed with status code 500' });
    expect(extractErrorMessage(err)).toBe('Request failed with status code 500');
  });

  it('falls back when data has only irrelevant keys', () => {
    const err = fakeAxiosError({
      data: { code: 42, timestamp: 'now' },
      message: 'unhelpful default',
    });
    expect(extractErrorMessage(err)).toBe('unhelpful default');
  });

  it('prefers message over error_description when both present', () => {
    const err = fakeAxiosError({
      data: { message: 'Specific', error_description: 'Generic' },
    });
    expect(extractErrorMessage(err)).toBe('Specific');
  });

  it('ignores empty-string message and tries the next shape', () => {
    const err = fakeAxiosError({
      data: { message: '', error_description: 'real reason' },
    });
    expect(extractErrorMessage(err)).toBe('real reason');
  });

  it('handles undefined data field on response gracefully', () => {
    const err = fakeAxiosError({ message: 'Network Error' });
    expect(extractErrorMessage(err)).toBe('Network Error');
  });
});
