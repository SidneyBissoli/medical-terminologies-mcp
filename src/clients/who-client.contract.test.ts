/**
 * Contract tests for WHOClient.
 *
 * No live fixtures here (WHO requires OAuth creds we don't ship with
 * the repo) — all responses are synthesized inline. The tests focus on:
 *  - the OAuth client_credentials handshake + token caching
 *  - 401 → cache invalidation → re-throw as AUTH_EXPIRED
 *  - the parallel hierarchy fan-out (Promise.allSettled tolerating
 *    partial failure)
 *  - expires_in being honored from the token response
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { WHOClient } from './who-client.js';
import { cache } from '../utils/cache.js';

const TOKEN_HOST = 'https://icdaccessmanagement.who.int';
const API_HOST = 'https://id.who.int';
const TOKEN_PATH = '/connect/token';

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'test-bearer-token',
    token_type: 'Bearer',
    expires_in: 3600,
    ...overrides,
  };
}

function setupCreds() {
  process.env.WHO_CLIENT_ID = 'test-client';
  process.env.WHO_CLIENT_SECRET = 'test-secret';
}

describe('WHOClient — contract tests', () => {
  let client: WHOClient;

  beforeEach(() => {
    cache.flush();
    setupCreds();
    client = new WHOClient();
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    delete process.env.WHO_CLIENT_ID;
    delete process.env.WHO_CLIENT_SECRET;
  });

  describe('OAuth flow', () => {
    it('sends form-encoded client_credentials and forwards the bearer token', async () => {
      nock(TOKEN_HOST)
        .post(TOKEN_PATH, (body) => {
          // The body is x-www-form-urlencoded, the client serializes
          // URLSearchParams to a string. nock receives the parsed form.
          return (
            body.client_id === 'test-client' &&
            body.client_secret === 'test-secret' &&
            body.grant_type === 'client_credentials' &&
            body.scope === 'icdapi_access'
          );
        })
        .reply(200, tokenResponse());

      nock(API_HOST)
        .get(/\/icd\/release\/11\/[\d-]+\/mms\/search/)
        .query(true)
        .matchHeader('authorization', 'Bearer test-bearer-token')
        .matchHeader('accept-language', 'en')
        .reply(200, {
          error: false,
          resultChopped: false,
          words: ['diabetes'],
          destinationEntities: [
            {
              id: 'http://id.who.int/icd/entity/12345',
              theCode: '5A11',
              title: 'Type 2 diabetes mellitus',
              isLeaf: true,
              postcoordinationAvailability: 'Mandatory',
              hasCodingNote: false,
              matchingPVs: [],
              score: 1.0,
            },
          ],
        });

      const r = await client.search('diabetes', 'en', 5);
      expect(r.destinationEntities).toHaveLength(1);
      expect(r.destinationEntities[0].theCode).toBe('5A11');
      expect(nock.isDone()).toBe(true);
    });

    it('caches the token across calls (one /token, two /search)', async () => {
      // .once() throws if the token endpoint is hit a second time —
      // proves the cache is working.
      nock(TOKEN_HOST).post(TOKEN_PATH).once().reply(200, tokenResponse());

      const apiNock = nock(API_HOST)
        .get(/\/icd\/release\/11\/[\d-]+\/mms\/search/)
        .query(true)
        .twice()
        .reply(200, {
          error: false,
          resultChopped: false,
          words: [],
          destinationEntities: [],
        });

      // Two distinct queries to bypass the search-result cache.
      await client.search('diabetes', 'en', 5);
      await client.search('hypertension', 'en', 5);

      expect(nock.isDone()).toBe(true);
      apiNock.done();
    });

    it('writes expires_in-derived TTL into the token cache entry', async () => {
      // We verify the TTL math (`max(60, expires_in - 60)`) by inspecting
      // what the client wrote into the cache after one successful token
      // exchange. Faking Date.now to test refresh would leak state into
      // the rate limiter (lastRefill in the future → subsequent tests
      // wait minutes for tokens), so we test the math directly.
      nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, tokenResponse({ expires_in: 7200 }));
      nock(API_HOST)
        .get(/\/icd\/release\/11\/[\d-]+\/mms\/search/)
        .query(true)
        .reply(200, { error: false, resultChopped: false, words: [], destinationEntities: [] });

      const before = Date.now();
      await client.search('diabetes', 'en', 5);
      const after = Date.now();

      const cached = cache.get<{ accessToken: string; expiresAt: number }>('token', 'who_oauth_token');
      expect(cached).toBeDefined();
      expect(cached!.accessToken).toBe('test-bearer-token');
      // expiresAt = Date.now() + (expires_in - 60) * 1000. With
      // expires_in=7200, the TTL is 7140s = 7,140,000 ms. Allow a wide
      // window to absorb test-runner timing slop.
      const lowerBound = before + 7140 * 1000 - 50;
      const upperBound = after + 7140 * 1000 + 50;
      expect(cached!.expiresAt).toBeGreaterThanOrEqual(lowerBound);
      expect(cached!.expiresAt).toBeLessThanOrEqual(upperBound);
    });

    it('floors TTL at 60 seconds when API returns absurdly short expires_in', async () => {
      nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, tokenResponse({ expires_in: 30 }));
      nock(API_HOST)
        .get(/\/icd\/release\/11\/[\d-]+\/mms\/search/)
        .query(true)
        .reply(200, { error: false, resultChopped: false, words: [], destinationEntities: [] });

      const before = Date.now();
      await client.search('diabetes', 'en', 5);
      const after = Date.now();

      const cached = cache.get<{ accessToken: string; expiresAt: number }>('token', 'who_oauth_token');
      expect(cached).toBeDefined();
      // floor(60, expires_in - 60) — for expires_in=30, max(60, -30)=60.
      const lowerBound = before + 60 * 1000 - 50;
      const upperBound = after + 60 * 1000 + 50;
      expect(cached!.expiresAt).toBeGreaterThanOrEqual(lowerBound);
      expect(cached!.expiresAt).toBeLessThanOrEqual(upperBound);
    });

    it('on 401 from the API, invalidates the token cache and throws AUTH_EXPIRED', async () => {
      nock(TOKEN_HOST).post(TOKEN_PATH).once().reply(200, tokenResponse());

      nock(API_HOST)
        .get(/\/icd\/release\/11\/[\d-]+\/mms\/search/)
        .query(true)
        .times(3) // initial + 2 retries
        .reply(401, { error: true, errorMessage: 'Unauthorized' });

      await expect(client.search('diabetes', 'en', 5)).rejects.toMatchObject({
        code: 'AUTH_EXPIRED',
      });
    });
  });

  describe('lookup and getEntity', () => {
    it('lookup by code uses /codeinfo path', async () => {
      nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, tokenResponse());
      nock(API_HOST)
        .get(/\/icd\/release\/11\/[\d-]+\/mms\/codeinfo\/5A11/)
        .reply(200, {
          '@id': 'http://id.who.int/icd/entity/12345',
          code: '5A11',
          title: { '@language': 'en', '@value': 'Type 2 diabetes mellitus' },
        });

      const e = await client.lookup('5A11', 'en');
      expect(e.code).toBe('5A11');
    });

    it('lookup by code follows the codeinfo stemId to the real entity (live shape, 2026-09-03)', async () => {
      nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, tokenResponse());
      // What the live API actually returns for /codeinfo: a resolver record
      // with no title and no parents.
      nock(API_HOST)
        .get(/\/icd\/release\/11\/[\d-]+\/mms\/codeinfo\/5A11/)
        .reply(200, {
          '@context': 'http://id.who.int/icd/contexts/contextForCodeInfo.json',
          '@id': 'http://id.who.int/icd/release/11/2026-01/mms/codeinfo/5A11',
          stemId: 'http://id.who.int/icd/release/11/2026-01/mms/119724091',
          code: '5A11',
        });
      nock(API_HOST)
        .get('/icd/release/11/2026-01/mms/119724091')
        .reply(200, {
          '@id': 'http://id.who.int/icd/release/11/2026-01/mms/119724091',
          code: '5A11',
          title: { '@language': 'en', '@value': 'Type 2 diabetes mellitus' },
          parent: ['http://id.who.int/icd/release/11/2026-01/mms/1630407678'],
        });

      const e = await client.lookup('5A11', 'en');
      expect(e['@id']).toBe('http://id.who.int/icd/release/11/2026-01/mms/119724091');
      expect(e.title?.['@value']).toBe('Type 2 diabetes mellitus');
      expect(e.parent).toHaveLength(1);
    });

    it('lookup by URI strips the absolute prefix and reuses the path', async () => {
      nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, tokenResponse());
      nock(API_HOST)
        .get('/icd/entity/12345')
        .reply(200, { '@id': 'http://id.who.int/icd/entity/12345' });

      const e = await client.lookup('http://id.who.int/icd/entity/12345', 'en');
      expect(e['@id']).toBe('http://id.who.int/icd/entity/12345');
    });
  });

  describe('getParents — Promise.allSettled fan-out', () => {
    it('returns successful parents and skips failed lookups', async () => {
      nock(TOKEN_HOST).post(TOKEN_PATH).reply(200, tokenResponse());
      // The first call is the entity itself (lookup), which contains
      // parent URIs the client then fetches in parallel.
      nock(API_HOST)
        .get(/\/icd\/release\/11\/[\d-]+\/mms\/codeinfo\/5A11/)
        .reply(200, {
          '@id': 'http://id.who.int/icd/entity/5A11',
          parent: [
            'http://id.who.int/icd/entity/p1',
            'http://id.who.int/icd/entity/p2',
            'http://id.who.int/icd/entity/p3',
          ],
        });
      nock(API_HOST).get('/icd/entity/p1').reply(200, { '@id': 'http://id.who.int/icd/entity/p1', code: 'P1' });
      // p2 is unreachable for the duration of all retries (initial + 2 retries = 3 calls).
      nock(API_HOST).get('/icd/entity/p2').times(3).reply(500, '');
      nock(API_HOST).get('/icd/entity/p3').reply(200, { '@id': 'http://id.who.int/icd/entity/p3', code: 'P3' });

      const parents = await client.getParents('5A11', 'en');
      // p2 dropped, p1 and p3 returned in original order.
      expect(parents.map((p) => p.code)).toEqual(['P1', 'P3']);
    });
  });

  describe('constructor', () => {
    it('throws AUTH_CONFIG_ERROR when creds are missing', () => {
      delete process.env.WHO_CLIENT_ID;
      delete process.env.WHO_CLIENT_SECRET;
      expect(() => new WHOClient()).toThrow(/credentials not configured/);
    });
  });
});
