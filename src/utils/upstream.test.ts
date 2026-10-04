/**
 * The trip to the origin through the shared fetch (`src/utils/upstream.ts`):
 * the policy of repetition, and — through the server's own layers (the
 * `HttpClient` of each source, the WHO client with its OAuth token, the
 * provenance builder) — the COUNT that reaches the `retrieval` block of
 * each source: measured when there was a trip to THAT origin in this call,
 * `null` for the sources that were not contacted, for bundled data, and
 * outside a collector.
 *
 * Fetch doubled with nock (real `Response`: the package reads `headers` and
 * the adapter reads `text()`); the backoff wait is silenced by
 * `upstreamIo.sleep` and COUNTED — the clock is what proves the policy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import type { RetryContext } from '@sbissoli/mcp-upstream';
import { HttpClient, HttpError } from './http.js';
import { cache, CACHE_PREFIX } from './cache.js';
import {
  retrievalFor,
  retryUpstream,
  UPSTREAM_POLICY,
  upstreamCallFor,
  upstreamIo,
  userAgent,
  withUpstreamCalls,
} from './upstream.js';
import { MEDICAL_SOURCES, medicalProvenance } from '../provenance.js';
import { WHOClient } from '../clients/who-client.js';

const RXNAV = 'https://rxnav.nlm.nih.gov';
const MESH = 'https://id.nlm.nih.gov';
const WHO_TOKEN = 'https://icdaccessmanagement.who.int';
const WHO_API = 'https://id.who.int';

function ctx(kind: RetryContext['kind'], status?: number): RetryContext {
  return { url: 'https://x.test/', attempt: 1, kind, status, response: undefined, body: undefined };
}

describe('retryUpstream — the policy (the package says the class, this server decides)', () => {
  it('repeats what is transient: 5xx, 429, network', () => {
    expect(retryUpstream(ctx('http_5xx', 503))).toBe(true);
    expect(retryUpstream(ctx('rate_limited', 429))).toBe(true);
    expect(retryUpstream(ctx('network'))).toBe(true);
  });

  it('does NOT repeat a timeout (the ceiling was already spent) nor a 4xx (404 never reaches the policy)', () => {
    expect(retryUpstream(ctx('timeout'))).toBe(false);
    expect(retryUpstream(ctx('http_4xx', 401))).toBe(false);
  });

  it('preserves the ceilings each client had before 1.15.0', () => {
    expect(UPSTREAM_POLICY.timeoutMs[CACHE_PREFIX.ICD11]).toBe(30_000);
    expect(UPSTREAM_POLICY.timeoutMs[CACHE_PREFIX.LOINC]).toBe(30_000);
    expect(UPSTREAM_POLICY.timeoutMs[CACHE_PREFIX.RXNORM]).toBe(30_000);
    expect(UPSTREAM_POLICY.timeoutMs[CACHE_PREFIX.MESH]).toBe(30_000);
    expect(UPSTREAM_POLICY.timeoutMs[CACHE_PREFIX.TOKEN]).toBe(15_000);
    expect(UPSTREAM_POLICY.retries).toBe(2);
  });

  it('identifies the server to upstream sysadmins (portfolio User-Agent with a contact)', () => {
    expect(userAgent()).toMatch(/^medical-terminologies-mcp\/\d+\.\d+\.\d+ \(https:\/\/medical\.sidneybissoli\.com; sbissoli76@gmail\.com\)$/);
  });
});

describe('the count that reaches the provenance block, per source', () => {
  let sleeps: number[];

  beforeEach(() => {
    nock.disableNetConnect();
    cache.flush();
    sleeps = [];
    vi.spyOn(upstreamIo, 'sleep').mockImplementation(async (ms) => {
      sleeps.push(ms);
    });
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    vi.restoreAllMocks();
    delete process.env.WHO_CLIENT_ID;
    delete process.env.WHO_CLIENT_SECRET;
  });

  it('a clean trip: {1 request, 1 attempt, no anomaly}, unstable=false', async () => {
    nock(RXNAV)
      .get('/REST/rxcui.json')
      .query({ name: 'aspirin' })
      .matchHeader('user-agent', /^medical-terminologies-mcp\/.* sbissoli76@gmail\.com\)$/)
      .reply(200, { idGroup: { rxnormId: ['1191'] } });

    await withUpstreamCalls(async () => {
      const client = new HttpClient({ source: CACHE_PREFIX.RXNORM, baseURL: `${RXNAV}/REST` });
      await client.get('/rxcui.json', { params: { name: 'aspirin' } });

      expect(retrievalFor(['rxnorm'])).toEqual({ requests: 1, attempts: 1, anomalies: [] });
      const block = medicalProvenance('NLM_RXNAV');
      expect(block.retrieval).toEqual({ requests: 1, attempts: 1, anomalies: [], unstable: false });
      // ATC shares RxNav — same host, same trips — so it reads the same collector.
      expect(medicalProvenance('NLM_RXCLASS_ATC').retrieval).toEqual(block.retrieval);
    });
    expect(nock.isDone()).toBe(true);
  });

  it('a 503 worked around: {1, 2, [http_5xx×1]}, unstable=true, one wait of 1 s', async () => {
    nock(RXNAV).get('/REST/rxcui.json').query(true).reply(503, 'busy');
    nock(RXNAV).get('/REST/rxcui.json').query(true).reply(200, { idGroup: {} });

    await withUpstreamCalls(async () => {
      const client = new HttpClient({ source: CACHE_PREFIX.RXNORM, baseURL: `${RXNAV}/REST` });
      const res = await client.get('/rxcui.json', { params: { name: 'x' } });
      expect(res.status).toBe(200);

      expect(medicalProvenance('NLM_RXNAV').retrieval).toEqual({
        requests: 1,
        attempts: 2,
        anomalies: [{ kind: 'http_5xx', count: 1 }],
        unstable: true,
      });
    });
    expect(sleeps).toEqual([1000]);
  });

  it('one block per source: the anomaly of MeSH does NOT leak into the RxNorm block', async () => {
    nock(RXNAV).get('/REST/rxcui.json').query(true).reply(200, { idGroup: {} });
    nock(MESH).get('/mesh/lookup/descriptor').query(true).reply(502, '<html>Bad Gateway</html>');
    nock(MESH).get('/mesh/lookup/descriptor').query(true).reply(200, []);

    await withUpstreamCalls(async () => {
      const rxnorm = new HttpClient({ source: CACHE_PREFIX.RXNORM, baseURL: `${RXNAV}/REST` });
      const mesh = new HttpClient({ source: CACHE_PREFIX.MESH, baseURL: `${MESH}/mesh` });
      await Promise.all([
        rxnorm.get('/rxcui.json', { params: { name: 'x' } }),
        mesh.get('/lookup/descriptor', { params: { label: 'x' } }),
      ]);

      expect(medicalProvenance('NLM_RXNAV').retrieval).toEqual({
        requests: 1,
        attempts: 1,
        anomalies: [],
        unstable: false,
      });
      expect(medicalProvenance('NLM_MESH').retrieval).toEqual({
        requests: 1,
        attempts: 2,
        anomalies: [{ kind: 'http_5xx', count: 1 }],
        unstable: true,
      });
      // A source that was not contacted in this call has nothing to report.
      expect(medicalProvenance('CLINICALTABLES_LOINC').retrieval).toBeNull();
      expect(medicalProvenance('WHO_ICD_API').retrieval).toBeNull();
    });
  });

  it('a 404 counts as a trip and an attempt, never as an anomaly, and is not repeated', async () => {
    nock(RXNAV).get('/REST/rxcui/0/properties.json').reply(404, '');

    await withUpstreamCalls(async () => {
      const client = new HttpClient({ source: CACHE_PREFIX.RXNORM, baseURL: `${RXNAV}/REST` });
      const err = await client.get('/rxcui/0/properties.json').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(404);
      expect(retrievalFor(['rxnorm'])).toEqual({ requests: 1, attempts: 1, anomalies: [] });
    });
    expect(sleeps).toEqual([]);
  });

  it('origin down: 3 attempts with waits of 1 s and 2 s, then HttpError without status', async () => {
    nock(RXNAV).get('/REST/rxcui.json').query(true).times(3).replyWithError(new Error('connect ECONNREFUSED'));

    await withUpstreamCalls(async () => {
      const client = new HttpClient({ source: CACHE_PREFIX.RXNORM, baseURL: `${RXNAV}/REST` });
      const err = await client.get('/rxcui.json', { params: { name: 'x' } }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBeUndefined();
      expect((err as HttpError).message).toMatch(/ECONNREFUSED \(after 3 attempts\)$/);
      // The failed trip is counted (the block only goes out on success —
      // it matters when a tool swallows the failure of one slice).
      expect(retrievalFor(['rxnorm'])).toEqual({
        requests: 1,
        attempts: 3,
        anomalies: [{ kind: 'network', count: 3 }],
      });
    });
    expect(sleeps).toEqual([1000, 2000]);
    expect(nock.isDone()).toBe(true);
  });

  it('the WHO OAuth token is infrastructure: its trip never reaches the ICD-11 block', async () => {
    process.env.WHO_CLIENT_ID = 'test-client';
    process.env.WHO_CLIENT_SECRET = 'test-secret';
    nock(WHO_TOKEN).post('/connect/token').reply(503, '');
    nock(WHO_TOKEN).post('/connect/token').reply(200, { access_token: 't', expires_in: 3600 });
    nock(WHO_API)
      .get('/icd/entity/1')
      .matchHeader('authorization', 'Bearer t')
      .reply(200, { '@id': 'http://id.who.int/icd/entity/1' });

    await withUpstreamCalls(async () => {
      const client = new WHOClient();
      await client.request('/entity/1');

      // The token trip (with its worked-around 503) lives under its own key…
      expect(retrievalFor(['token'])).toEqual({
        requests: 1,
        attempts: 2,
        anomalies: [{ kind: 'http_5xx', count: 1 }],
      });
      // …that no preset lists, so the ICD-11 block reports only the data trip.
      expect(medicalProvenance('WHO_ICD_API').retrieval).toEqual({
        requests: 1,
        attempts: 1,
        anomalies: [],
        unstable: false,
      });
    });
    for (const src of Object.values(MEDICAL_SOURCES)) {
      expect(src.cachePrefixes).not.toContain(CACHE_PREFIX.TOKEN);
    }
  });

  it('bundled data and a call without trips report null, never an invented count', async () => {
    await withUpstreamCalls(async () => {
      expect(medicalProvenance('DATASUS_CID10').retrieval).toBeNull();
      expect(medicalProvenance('WHO_TRANSITION_TABLES').retrieval).toBeNull();
      expect(medicalProvenance('NLM_RXNAV').retrieval).toBeNull();
      expect(retrievalFor(['rxnorm', 'mesh'])).toBeNull();
    });
  });

  it('outside a collector the trip still has the policy, and the block says "not measured"', async () => {
    nock(RXNAV).get('/REST/rxcui.json').query(true).reply(503, '');
    nock(RXNAV).get('/REST/rxcui.json').query(true).reply(200, { idGroup: {} });

    const client = new HttpClient({ source: CACHE_PREFIX.RXNORM, baseURL: `${RXNAV}/REST` });
    const res = await client.get('/rxcui.json', { params: { name: 'x' } });

    expect(res.status).toBe(200);
    expect(sleeps).toEqual([1000]);
    expect(retrievalFor(['rxnorm'])).toBeNull();
    expect(medicalProvenance('NLM_RXNAV').retrieval).toBeNull();
  });

  it('a nested collector reuses the open one: the outer tool keeps the inner trips', async () => {
    nock(RXNAV).get('/REST/rxcui.json').query(true).reply(200, { idGroup: {} });

    await withUpstreamCalls(async () => {
      const outer = upstreamCallFor(CACHE_PREFIX.RXNORM);
      await withUpstreamCalls(async () => {
        expect(upstreamCallFor(CACHE_PREFIX.RXNORM)).toBe(outer);
        const client = new HttpClient({ source: CACHE_PREFIX.RXNORM, baseURL: `${RXNAV}/REST` });
        await client.get('/rxcui.json', { params: { name: 'x' } });
      });
      expect(retrievalFor(['rxnorm'])).toEqual({ requests: 1, attempts: 1, anomalies: [] });
    });
  });

  it('a preset spanning two collectors gets the sum, anomalies in the canonical order', async () => {
    nock(RXNAV).get('/REST/a').reply(503, '');
    nock(RXNAV).get('/REST/a').reply(200, {});
    nock(MESH).get('/mesh/b').reply(429, '', { 'Retry-After': '1' });
    nock(MESH).get('/mesh/b').reply(200, {});

    await withUpstreamCalls(async () => {
      await new HttpClient({ source: CACHE_PREFIX.RXNORM, baseURL: `${RXNAV}/REST` }).get('/a');
      await new HttpClient({ source: CACHE_PREFIX.MESH, baseURL: `${MESH}/mesh` }).get('/b');

      expect(retrievalFor(['mesh', 'rxnorm'])).toEqual({
        requests: 2,
        attempts: 4,
        anomalies: [
          { kind: 'http_5xx', count: 1 },
          { kind: 'rate_limited', count: 1 },
        ],
      });
    });
    expect(sleeps).toEqual([1000, 1000]);
  });
});
