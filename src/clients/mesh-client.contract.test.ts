/**
 * Contract tests for MeSHClient.
 *
 * Pin the parser against the actual NLM MeSH JSON-LD response shape
 * captured live in src/__fixtures__/mesh/. If NLM ever changes the
 * descriptor / concept / term / qualifier endpoint shapes again, these
 * tests fail close to the change instead of letting tools silently
 * return empty data (which is exactly what shipped before commit
 * before this rewrite — see improvements.md P1 about MeSH JSON-LD
 * drift).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nock from 'nock';
import { MeSHClient } from './mesh-client.js';
import { cache } from '../utils/cache.js';

const FIXTURES = join(process.cwd(), 'src', '__fixtures__', 'mesh');

// Cast to `any` because nock's `.reply(status, body)` typing is overloaded
// in a way that rejects `unknown`. The fixtures are real JSON parsed from
// disk; runtime safety isn't an issue here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixture(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

const HOST = 'https://id.nlm.nih.gov';
const BASE = '/mesh';

describe('MeSHClient — contract tests against captured live fixtures', () => {
  let client: MeSHClient;

  beforeEach(() => {
    // Per-test cache flush — node-cache is process-global, so without
    // this, fixtures from previous tests would leak across cases and
    // hide whether the client is actually hitting the mocked endpoints.
    cache.flush();
    client = new MeSHClient();
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('searchDescriptors', () => {
    it('parses /lookup/descriptor response into id/uri/label tuples', async () => {
      nock(HOST)
        .get(`${BASE}/lookup/descriptor`)
        .query({ label: 'hypertension', match: 'contains', limit: 5 })
        .reply(200, fixture('lookup-hypertension.json'));

      const results = await client.searchDescriptors('hypertension', 'contains', 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^D\d+$/),
          uri: expect.stringContaining('http://id.nlm.nih.gov/mesh/D'),
          label: expect.any(String),
        }),
      );
    });

    it('returns [] on empty/non-array response', async () => {
      nock(HOST)
        .get(`${BASE}/lookup/descriptor`)
        .query(true)
        .reply(200, []);
      const results = await client.searchDescriptors('zzz_no_match', 'contains', 5);
      expect(results).toEqual([]);
    });
  });

  describe('getDescriptor — fan-out parser', () => {
    it('assembles label, scope_note (from concept), tree numbers, terms, qualifiers', async () => {
      // Descriptor fetch
      nock(HOST).get(`${BASE}/D006973.json`).reply(200, fixture('descriptor-D006973.json'));
      // Tree number fetch (single tree for D006973)
      nock(HOST)
        .get(`${BASE}/C14.907.489.json`)
        .reply(200, fixture('treenumber-C14.907.489.json'));
      // Concept fetch (preferredConcept of D006973)
      nock(HOST).get(`${BASE}/M0010859.json`).reply(200, fixture('concept-M0010859.json'));
      // Term fetches: preferredTerm + non-preferred term referenced by concept
      nock(HOST).get(`${BASE}/T020937.json`).reply(200, fixture('term-T020937.json'));
      nock(HOST).get(`${BASE}/T020938.json`).reply(200, fixture('term-T020938.json'));
      // Qualifier fetches — 35 of them in this descriptor; mock all with the
      // same fixture (label parsing is the only thing we're testing).
      const descriptor = fixture('descriptor-D006973.json') as { allowableQualifier: string[] };
      const qIds = descriptor.allowableQualifier.map((u) =>
        u.replace('http://id.nlm.nih.gov/mesh/', ''),
      );
      for (const qId of qIds) {
        nock(HOST).get(`${BASE}/${qId}.json`).reply(200, fixture('qualifier-Q000503.json'));
      }

      const d = await client.getDescriptor('D006973');

      expect(d).not.toBeNull();
      expect(d!.id).toBe('D006973');
      expect(d!.label).toBe('Hypertension');
      // Scope note is the user-facing definition, sourced from the
      // preferred concept (NOT the descriptor's `annotation` field).
      expect(d!.scopeNote).toMatch(/Persistently high systemic arterial BLOOD PRESSURE/);
      expect(d!.treeNumbers).toEqual([
        { treeNumber: 'C14.907.489', uri: 'http://id.nlm.nih.gov/mesh/C14.907.489' },
      ]);
      expect(d!.concepts).toHaveLength(1);
      expect(d!.concepts[0].label).toBe('Hypertension');
      expect(d!.concepts[0].isPreferred).toBe(true);
      // Two terms: T020937 (Hypertension preferred) + T020938 (Blood Pressure, High)
      expect(d!.concepts[0].terms).toEqual(['Hypertension', 'Blood Pressure, High']);
      // 35 qualifiers, all labels populated (we mocked them all to the same fixture)
      expect(d!.qualifiers).toHaveLength(35);
      for (const q of d!.qualifiers) {
        expect(q.label).toBe('physiopathology');
        expect(q.id).toMatch(/^Q\d+$/);
      }
    });

    it('handles descriptors with multiple tree numbers (D003920 = Diabetes)', async () => {
      nock(HOST).get(`${BASE}/D003920.json`).reply(200, fixture('descriptor-D003920.json'));
      // Multi-tree case: D003920 has 2 trees
      nock(HOST).get(`${BASE}/C18.452.394.750.json`).reply(200, {
        '@id': 'http://id.nlm.nih.gov/mesh/C18.452.394.750',
        label: { '@language': 'en', '@value': 'C18.452.394.750' },
      });
      nock(HOST).get(`${BASE}/C19.246.json`).reply(200, {
        '@id': 'http://id.nlm.nih.gov/mesh/C19.246',
        label: { '@language': 'en', '@value': 'C19.246' },
      });
      // Stub concept + term + qualifiers minimally — we only care about the
      // tree-number normalization here.
      nock(HOST)
        .get(`${BASE}/M0006148.json`)
        .reply(200, { '@id': 'http://id.nlm.nih.gov/mesh/M0006148' });
      const descriptor = fixture('descriptor-D003920.json') as { allowableQualifier: string[] };
      for (const u of descriptor.allowableQualifier) {
        const id = u.replace('http://id.nlm.nih.gov/mesh/', '');
        nock(HOST).get(`${BASE}/${id}.json`).reply(200, { label: { '@value': '' } });
      }

      const d = await client.getDescriptor('D003920');
      expect(d!.treeNumbers).toEqual([
        { treeNumber: 'C18.452.394.750', uri: 'http://id.nlm.nih.gov/mesh/C18.452.394.750' },
        { treeNumber: 'C19.246', uri: 'http://id.nlm.nih.gov/mesh/C19.246' },
      ]);
    });

    it('returns null on 404 from NLM', async () => {
      nock(HOST).get(`${BASE}/D000000.json`).reply(404, '');
      const d = await client.getDescriptor('D000000');
      expect(d).toBeNull();
    });

    it('survives partial qualifier-label fetch failures', async () => {
      nock(HOST).get(`${BASE}/D006973.json`).reply(200, fixture('descriptor-D006973.json'));
      nock(HOST)
        .get(`${BASE}/C14.907.489.json`)
        .reply(200, fixture('treenumber-C14.907.489.json'));
      nock(HOST).get(`${BASE}/M0010859.json`).reply(200, fixture('concept-M0010859.json'));
      nock(HOST).get(`${BASE}/T020937.json`).reply(200, fixture('term-T020937.json'));
      nock(HOST).get(`${BASE}/T020938.json`).reply(200, fixture('term-T020938.json'));
      const descriptor = fixture('descriptor-D006973.json') as { allowableQualifier: string[] };
      const qIds = descriptor.allowableQualifier.map((u) =>
        u.replace('http://id.nlm.nih.gov/mesh/', ''),
      );
      // First half: success. Second half: 500 errors — should result in
      // empty labels but not throw.
      qIds.forEach((qId, i) => {
        if (i < 17) {
          nock(HOST).get(`${BASE}/${qId}.json`).reply(200, fixture('qualifier-Q000503.json'));
        } else {
          // Retry path will hit 500 maxRetries times, so allow each id to
          // fail multiple times (withRetry retries 2 times → 3 total attempts).
          nock(HOST).get(`${BASE}/${qId}.json`).times(3).reply(500, '');
        }
      });

      const d = await client.getDescriptor('D006973');

      expect(d).not.toBeNull();
      expect(d!.qualifiers).toHaveLength(35);
      const populated = d!.qualifiers.filter((q) => q.label.length > 0);
      const empty = d!.qualifiers.filter((q) => q.label.length === 0);
      expect(populated.length).toBe(17);
      expect(empty.length).toBe(18);
    }, 15000);
  });

  describe('getTreeNumbers', () => {
    it('returns just the tree numbers without forcing concept/qualifier fetches', async () => {
      nock(HOST).get(`${BASE}/D006973.json`).reply(200, fixture('descriptor-D006973.json'));
      nock(HOST)
        .get(`${BASE}/C14.907.489.json`)
        .reply(200, fixture('treenumber-C14.907.489.json'));

      const trees = await client.getTreeNumbers('D006973');
      expect(trees).toEqual([
        { treeNumber: 'C14.907.489', uri: 'http://id.nlm.nih.gov/mesh/C14.907.489' },
      ]);
      // Critically: nock should be done — meaning we did NOT call the
      // concept, term, or qualifier endpoints. getTreeNumbers must be
      // a strict subset of the descriptor fan-out.
      expect(nock.isDone()).toBe(true);
    });
  });

  describe('getAllowedQualifiers', () => {
    it('returns qualifier id+uri+label, fans out one fetch per qualifier', async () => {
      nock(HOST).get(`${BASE}/D006973.json`).reply(200, fixture('descriptor-D006973.json'));
      const descriptor = fixture('descriptor-D006973.json') as { allowableQualifier: string[] };
      const qIds = descriptor.allowableQualifier.map((u) =>
        u.replace('http://id.nlm.nih.gov/mesh/', ''),
      );
      for (const qId of qIds) {
        nock(HOST).get(`${BASE}/${qId}.json`).reply(200, fixture('qualifier-Q000503.json'));
      }

      const quals = await client.getAllowedQualifiers('D006973');
      expect(quals.length).toBe(35);
      expect(quals.every((q) => q.label === 'physiopathology')).toBe(true);
      expect(nock.isDone()).toBe(true);
    });
  });

  describe('cache reuse across public methods', () => {
    it('descriptor fetch is shared between getDescriptor / getTreeNumbers / getAllowedQualifiers', async () => {
      // Allow each endpoint to be called only once. If any of the three
      // public methods refetches a resource that should already be cached,
      // nock throws "no match for request" on the second call.
      nock(HOST).get(`${BASE}/D006973.json`).once().reply(200, fixture('descriptor-D006973.json'));
      nock(HOST)
        .get(`${BASE}/C14.907.489.json`)
        .once()
        .reply(200, fixture('treenumber-C14.907.489.json'));
      nock(HOST).get(`${BASE}/M0010859.json`).once().reply(200, fixture('concept-M0010859.json'));
      nock(HOST).get(`${BASE}/T020937.json`).once().reply(200, fixture('term-T020937.json'));
      nock(HOST).get(`${BASE}/T020938.json`).once().reply(200, fixture('term-T020938.json'));
      const descriptor = fixture('descriptor-D006973.json') as { allowableQualifier: string[] };
      for (const u of descriptor.allowableQualifier) {
        const id = u.replace('http://id.nlm.nih.gov/mesh/', '');
        // Once for getDescriptor (warms cache), then served from cache for
        // getAllowedQualifiers — so just once.
        nock(HOST).get(`${BASE}/${id}.json`).once().reply(200, fixture('qualifier-Q000503.json'));
      }

      // Three calls in sequence — the descriptor + qualifier + term + tree
      // resources should each be fetched at most as many times as nock
      // permits above. If the cache layer regresses, nock throws.
      await client.getDescriptor('D006973');
      await client.getTreeNumbers('D006973');
      await client.getAllowedQualifiers('D006973');

      expect(nock.isDone()).toBe(true);
    });
  });
});
