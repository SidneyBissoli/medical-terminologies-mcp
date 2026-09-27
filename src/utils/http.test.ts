/**
 * Unit tests for the HttpClient over the shared fetch (`@sbissoli/mcp-upstream`).
 * Uses nock (v14+ intercepts native fetch) so these double as the canary that
 * the contract-test infrastructure still works after the axios → fetch
 * migration. The policy itself (what repeats, the waits) is proved here at
 * the adapter; the per-source COUNT that reaches the provenance block is
 * proved in upstream.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { HttpClient, HttpError } from './http.js';
import { upstreamIo } from './upstream.js';
import { CACHE_PREFIX } from './cache.js';

/** Any source: these tests are about the adapter, not the policy of one origin. */
const SOURCE = CACHE_PREFIX.LOINC;

const HOST = 'https://api.example.test';

describe('HttpClient', () => {
  let sleeps: number[];
  beforeEach(() => {
    nock.disableNetConnect();
    // The shared fetch repeats 5xx/429/network with backoff 1 s → 2 s; the
    // waits are silenced and COUNTED — the clock is the proof of the policy.
    sleeps = [];
    vi.spyOn(upstreamIo, 'sleep').mockImplementation(async (ms) => {
      sleeps.push(ms);
    });
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    vi.restoreAllMocks();
  });

  it('GET joins baseURL with relative paths and parses JSON', async () => {
    nock(HOST).get('/v1/thing').reply(200, { id: 7 });

    const client = new HttpClient({ source: SOURCE, baseURL: `${HOST}/v1` });
    const res = await client.get<{ id: number }>('/thing');

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: 7 });
  });

  it('GET with an absolute URL bypasses baseURL', async () => {
    nock('https://other.example.test').get('/x').reply(200, { ok: true });

    const client = new HttpClient({ source: SOURCE, baseURL: `${HOST}/v1` });
    const res = await client.get<{ ok: boolean }>('https://other.example.test/x');

    expect(res.data).toEqual({ ok: true });
  });

  it('appends params, stringifying numbers and booleans', async () => {
    nock(HOST)
      .get('/search')
      .query({ q: 'glucose', max: '25', flat: 'true' })
      .reply(200, []);

    const client = new HttpClient({ source: SOURCE, baseURL: HOST });
    const res = await client.get<unknown[]>('/search', {
      params: { q: 'glucose', max: 25, flat: true },
    });

    expect(res.data).toEqual([]);
  });

  it('merges config headers with per-request overrides', async () => {
    const scope = nock(HOST, {
      reqheaders: {
        accept: 'application/json',
        'accept-language': 'pt',
      },
    })
      .get('/h')
      .reply(200, {});

    const client = new HttpClient({
      source: SOURCE,
      baseURL: HOST,
      headers: { Accept: 'application/json', 'Accept-Language': 'en' },
    });
    await client.get('/h', { headers: { 'Accept-Language': 'pt' } });

    expect(scope.isDone()).toBe(true);
  });

  it('parses JSON bodies served without a JSON content-type', async () => {
    nock(HOST).get('/raw').reply(200, '{"a":1}', { 'Content-Type': 'text/plain' });

    const client = new HttpClient({ source: SOURCE, baseURL: HOST });
    const res = await client.get<{ a: number }>('/raw');

    expect(res.data).toEqual({ a: 1 });
  });

  it('returns undefined data for an empty 200 body', async () => {
    nock(HOST).get('/empty').reply(200, '');

    const client = new HttpClient({ source: SOURCE, baseURL: HOST });
    const res = await client.get('/empty');

    expect(res.data).toBeUndefined();
  });

  it('throws HttpError with status and parsed JSON data on non-2xx', async () => {
    nock(HOST).get('/missing').reply(404, { message: 'no such thing' });

    const client = new HttpClient({ source: SOURCE, baseURL: HOST });
    const err = await client.get('/missing').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
    expect((err as HttpError).data).toEqual({ message: 'no such thing' });
    expect((err as HttpError).message).toBe('Request failed with status code 404');
  });

  it('keeps a non-JSON error body as a string (HTML 502 pages) — after the retries the policy allows', async () => {
    // A 5xx is transient by class: 3 attempts (1 + 2 retries), then the
    // LAST response is what the caller sees, body included.
    nock(HOST).get('/down').times(3).reply(502, '<html>Bad Gateway</html>');

    const client = new HttpClient({ source: SOURCE, baseURL: HOST });
    const err = await client.get('/down').catch((e: unknown) => e);

    expect((err as HttpError).status).toBe(502);
    expect((err as HttpError).data).toBe('<html>Bad Gateway</html>');
    expect((err as HttpError).message).toBe('Request failed with status code 502 (after 3 attempts)');
    expect(sleeps).toEqual([1000, 2000]);
    expect(nock.isDone()).toBe(true);
  });

  it('does NOT repeat a 404: absence is the answer of the source (one attempt, no wait)', async () => {
    nock(HOST).get('/gone').reply(404, '');

    const client = new HttpClient({ source: SOURCE, baseURL: HOST });
    const err = await client.get('/gone').catch((e: unknown) => e);

    expect((err as HttpError).status).toBe(404);
    expect((err as HttpError).data).toBeUndefined();
    expect(sleeps).toEqual([]);
  });

  it('repeats a 429 honoring Retry-After, then succeeds', async () => {
    nock(HOST).get('/busy').reply(429, '', { 'Retry-After': '3' });
    nock(HOST).get('/busy').reply(200, { ok: true });

    const client = new HttpClient({ source: SOURCE, baseURL: HOST });
    const res = await client.get<{ ok: boolean }>('/busy');

    expect(res.data).toEqual({ ok: true });
    expect(sleeps).toEqual([3000]);
  });

  it('POST sends the body and parses the JSON response', async () => {
    nock(HOST)
      .post('/token', 'grant_type=client_credentials&scope=api')
      .reply(200, { access_token: 't', expires_in: 3600 });

    const client = new HttpClient({ source: SOURCE });
    const res = await client.post<{ access_token: string }>(
      `${HOST}/token`,
      new URLSearchParams({ grant_type: 'client_credentials', scope: 'api' }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    expect(res.data.access_token).toBe('t');
  });

  it('wraps network failures in HttpError with no status, after 3 attempts', async () => {
    nock(HOST).get('/net').times(3).replyWithError(new Error('connect ECONNRESET 1.2.3.4:443'));

    const client = new HttpClient({ source: SOURCE, baseURL: HOST });
    const err = await client.get('/net').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBeUndefined();
    expect((err as HttpError).message).toBe('connect ECONNRESET 1.2.3.4:443 (after 3 attempts)');
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('times out via AbortSignal and reports the configured timeout', async () => {
    nock(HOST).get('/slow').delay(500).reply(200, {});

    const client = new HttpClient({ source: SOURCE, baseURL: HOST, timeout: 25 });
    const err = await client.get('/slow').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBeUndefined();
    expect((err as HttpError).message).toBe('timeout of 25ms exceeded');
  });
});
