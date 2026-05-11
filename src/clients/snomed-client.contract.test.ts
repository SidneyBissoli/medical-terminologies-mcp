/**
 * Contract tests for SNOMEDClient.
 *
 * No live fixtures (the public IHTSDO Snowstorm endpoint was retired —
 * see PROGRESS.md Active Deferrals). All responses are synthesized inline based
 * on the documented Snowstorm REST shape, so when an operator points
 * `SNOMED_BASE_URL` at a self-hosted Snowstorm, these tests validate
 * the parser the operator's traffic will go through.
 *
 * Tests run regardless of `ENABLE_SNOMED_TOOLS` — the feature flag
 * gates registration of the tools, not the client class itself.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { SNOMEDClient } from './snomed-client.js';
import { cache } from '../utils/cache.js';

// SNOMED_CONFIG.baseUrl is resolved at module-load time, so we can't
// override SNOMED_BASE_URL from beforeEach. Tests intercept the
// retired-but-still-default URL instead — nock doesn't care that the
// upstream is dead, it intercepts on host+path match.
const HOST = 'https://browser.ihtsdotools.org';

describe('SNOMEDClient — contract tests', () => {
  let client: SNOMEDClient;

  beforeEach(() => {
    cache.flush();
    client = new SNOMEDClient();
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('searchConcepts', () => {
    it('flattens items[] preserving fsn.term and pt.term', async () => {
      nock(HOST)
        .get('/snowstorm/snomed-ct/MAIN/concepts')
        .query({ term: 'diabetes', activeFilter: true, limit: 5, offset: 0 })
        .reply(200, {
          items: [
            {
              conceptId: '73211009',
              fsn: { term: 'Diabetes mellitus (disorder)', lang: 'en' },
              pt: { term: 'Diabetes mellitus', lang: 'en' },
              active: true,
              definitionStatus: 'PRIMITIVE',
              moduleId: '900000000000207008',
            },
          ],
        });

      const r = await client.searchConcepts('diabetes', true, 5);
      expect(r).toHaveLength(1);
      expect(r[0]).toEqual({
        conceptId: '73211009',
        fsn: 'Diabetes mellitus (disorder)',
        pt: 'Diabetes mellitus',
        active: true,
        definitionStatus: 'PRIMITIVE',
        moduleId: '900000000000207008',
      });
    });

    it('returns [] when items is missing', async () => {
      nock(HOST)
        .get('/snowstorm/snomed-ct/MAIN/concepts')
        .query(true)
        .reply(200, {});
      expect(await client.searchConcepts('zzz', true, 5)).toEqual([]);
    });

    it('handles fsn/pt being absent without crashing', async () => {
      nock(HOST)
        .get('/snowstorm/snomed-ct/MAIN/concepts')
        .query(true)
        .reply(200, {
          items: [
            { conceptId: '1', active: true },
          ],
        });
      const r = await client.searchConcepts('x', true, 5);
      expect(r[0].fsn).toBe('');
      expect(r[0].pt).toBe('');
    });
  });

  describe('getConcept', () => {
    it('parses a single-concept response', async () => {
      nock(HOST)
        .get('/snowstorm/snomed-ct/MAIN/concepts/73211009')
        .reply(200, {
          conceptId: '73211009',
          fsn: { term: 'Diabetes mellitus (disorder)' },
          pt: { term: 'Diabetes mellitus' },
          active: true,
          effectiveTime: '20020131',
          definitionStatus: 'PRIMITIVE',
          moduleId: '900000000000207008',
        });

      const c = await client.getConcept('73211009');
      expect(c).not.toBeNull();
      expect(c!.conceptId).toBe('73211009');
      expect(c!.fsn).toBe('Diabetes mellitus (disorder)');
    });

    it('returns null on 404 (concept not found)', async () => {
      nock(HOST)
        .get('/snowstorm/snomed-ct/MAIN/concepts/99999999999')
        .reply(404, { message: 'Concept not found' });
      const c = await client.getConcept('99999999999');
      expect(c).toBeNull();
    });
  });

  describe('Accept-Language propagation', () => {
    it('forwards SNOMED_LANGUAGE env into Accept-Language header', async () => {
      // Re-create the client with PT-BR set so the language is captured
      // at construction.
      delete process.env.SNOMED_BASE_URL;
      process.env.SNOMED_BASE_URL = `${HOST}/snowstorm/snomed-ct`;
      process.env.SNOMED_LANGUAGE = 'pt-BR,pt;q=0.9';
      try {
        const ptClient = new SNOMEDClient();
        nock(HOST)
          .matchHeader('accept-language', 'pt-BR,pt;q=0.9')
          .get('/snowstorm/snomed-ct/MAIN/concepts/73211009')
          .reply(200, { conceptId: '73211009', active: true });

        const c = await ptClient.getConcept('73211009');
        expect(c).not.toBeNull();
        expect(nock.isDone()).toBe(true);
      } finally {
        delete process.env.SNOMED_LANGUAGE;
      }
    });

    it('per-call language argument overrides the constructor default on getConcept', async () => {
      // Construct with env default 'en' (no SNOMED_LANGUAGE set), then
      // call with explicit 'es' — header for this request must be 'es'.
      nock(HOST)
        .matchHeader('accept-language', 'es')
        .get('/snowstorm/snomed-ct/MAIN/concepts/73211009')
        .reply(200, { conceptId: '73211009', active: true });

      const c = await client.getConcept('73211009', 'es');
      expect(c).not.toBeNull();
      expect(nock.isDone()).toBe(true);
    });

    it('per-call language argument overrides the constructor default on searchConcepts', async () => {
      nock(HOST)
        .matchHeader('accept-language', 'fr')
        .get('/snowstorm/snomed-ct/MAIN/concepts')
        .query({ term: 'diabetes', activeFilter: true, limit: 5, offset: 0 })
        .reply(200, { items: [] });

      const r = await client.searchConcepts('diabetes', true, 5, 'fr');
      expect(r).toEqual([]);
      expect(nock.isDone()).toBe(true);
    });

    it('cache key includes language — different language re-fetches', async () => {
      // First call with 'en' — populates cache.
      nock(HOST)
        .get('/snowstorm/snomed-ct/MAIN/concepts/73211009')
        .reply(200, { conceptId: '73211009', active: true, pt: { term: 'Diabetes mellitus' } });
      await client.getConcept('73211009', 'en');

      // Second call with 'pt' on the same SCTID — must NOT hit the en
      // cache entry; nock requires a fresh intercept to satisfy it.
      nock(HOST)
        .matchHeader('accept-language', 'pt')
        .get('/snowstorm/snomed-ct/MAIN/concepts/73211009')
        .reply(200, { conceptId: '73211009', active: true, pt: { term: 'Diabetes mellitus (pt)' } });

      const ptResult = await client.getConcept('73211009', 'pt');
      expect(ptResult?.pt).toBe('Diabetes mellitus (pt)');
      expect(nock.isDone()).toBe(true);
    });
  });

  describe('executeECL', () => {
    it('passes ecl + limit + offset to the concepts endpoint', async () => {
      nock(HOST)
        .get('/snowstorm/snomed-ct/MAIN/concepts')
        .query({ ecl: '<< 73211009', limit: 5, offset: 0 })
        .reply(200, {
          items: [
            {
              conceptId: '44054006',
              fsn: { term: 'Diabetes mellitus type 2 (disorder)' },
              pt: { term: 'Type 2 diabetes mellitus' },
              active: true,
            },
          ],
        });

      const r = await client.executeECL('<< 73211009', 5);
      expect(r).toHaveLength(1);
      expect(r[0].conceptId).toBe('44054006');
    });
  });
});
