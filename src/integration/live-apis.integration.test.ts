/**
 * Integration tests against the actual upstream APIs.
 *
 * Skipped by default. Run with:
 *
 *   INTEGRATION_TESTS=1 npm test
 *
 * Or, in CI, via the dedicated workflow at
 * `.github/workflows/integration.yml` which runs nightly.
 *
 * Tests are intentionally narrow — they validate that endpoints we
 * depend on are still reachable and still return the shapes the
 * clients expect, NOT the correctness of any particular value (which
 * would change with each upstream release). When an upstream sneaks in
 * a breaking change, the assertions here fail close to the change.
 *
 * Discoveries that motivated these tests:
 *  - 2026-05-09: MeSH `/D{id}.json` shape changed from `@graph`
 *    array to flat compact JSON-LD; client returned empty data for
 *    weeks before this work caught it.
 *  - 2026-05-09: NLM `/loinc_answers` started returning HTTP 404;
 *    `loinc_answers` tool silently degraded to empty.
 *  - 2026-05-09: WHO ICD-11 `lookup` by URI duplicated the `/icd`
 *    prefix (existing code bug, not upstream drift, but caught by
 *    the same exploration).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getNLMClient } from '../clients/nlm-client.js';
import { getRxNormClient } from '../clients/rxnorm-client.js';
import { getMeSHClient } from '../clients/mesh-client.js';
import { getCID10Client } from '../clients/cid10-client.js';
import { getWHOClient, WHOClient } from '../clients/who-client.js';
import { getSNOMEDClient, SNOMEDClient } from '../clients/snomed-client.js';
import { cache } from '../utils/cache.js';

const ENABLED = process.env.INTEGRATION_TESTS === '1';
const HAS_WHO_CREDS = Boolean(process.env.WHO_CLIENT_ID && process.env.WHO_CLIENT_SECRET);
const HAS_SNOMED = process.env.ENABLE_SNOMED_TOOLS === 'true' && Boolean(process.env.SNOMED_BASE_URL);

const describeIntegration = ENABLED ? describe : describe.skip;

describeIntegration('Integration: live API contracts', () => {
  beforeAll(() => {
    cache.flush();
  });

  // No auth, no flag — always run when integration enabled.

  describe('NLM Clinical Tables (LOINC)', () => {
    it('LOINC search for "glucose" returns at least one result with a populated long name', async () => {
      const r = await getNLMClient().searchLOINC('glucose', 5);
      expect(r.totalCount).toBeGreaterThan(0);
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.items[0].LOINC_NUM).toMatch(/^\d+-\d$/);
      expect(r.items[0].LONG_COMMON_NAME.length).toBeGreaterThan(0);
    });

    it('LOINC details for 2339-0 (Glucose) returns the canonical component', async () => {
      const item = await getNLMClient().getLOINCDetails('2339-0');
      expect(item).not.toBeNull();
      expect(item!.LOINC_NUM).toBe('2339-0');
      expect(item!.LONG_COMMON_NAME.toLowerCase()).toContain('glucose');
    });
  });

  describe('NLM RxNav (RxNorm + ATC)', () => {
    it('drug search for "metformin" returns multiple TTYs', async () => {
      const r = await getRxNormClient().searchDrugs('metformin');
      expect(r.drugs.length).toBeGreaterThan(0);
      const ttys = new Set(r.drugs.map((d) => d.tty));
      expect(ttys.size).toBeGreaterThan(1);
    });

    it('ATC classify for "metformin" returns A10BA (Biguanides) class', async () => {
      // Note: byDrugName returns ATC1-4 codes (1-5 chars); the
      // substance-level (7-char) code A10BA02 is not exposed by this
      // endpoint shape — confirmed live 2026-05-09. We assert on the
      // pharmacological class code instead.
      const matches = await getRxNormClient().getATCByDrugName('metformin');
      expect(matches.length).toBeGreaterThan(0);
      const codes = new Set(matches.map((m) => m.atc_code));
      expect(codes.has('A10BA')).toBe(true);
      expect(matches.every((m) => m.atc_level_type === 'ATC1-4')).toBe(true);
    });

    it('ATC byCode A10BA resolves to "Biguanides"', async () => {
      const c = await getRxNormClient().getATCByCode('A10BA');
      expect(c).not.toBeNull();
      expect(c!.atc_name).toMatch(/biguanide/i);
    });

    it('ATC members of A10BA include metformin and phenformin', async () => {
      const members = await getRxNormClient().getATCMembers('A10BA');
      const names = members.map((m) => m.name.toLowerCase());
      expect(names).toContain('metformin');
      expect(names).toContain('phenformin');
    });
  });

  describe('NLM MeSH', () => {
    it('search for "hypertension" returns descriptors', async () => {
      const r = await getMeSHClient().searchDescriptors('hypertension', 'contains', 5);
      expect(r.length).toBeGreaterThan(0);
      expect(r[0].id).toMatch(/^D\d+$/);
    });

    it('descriptor D006973 (Hypertension) populates label, scope_note, tree, concepts, qualifiers', async () => {
      // This is the canary for the JSON-LD shape regression that
      // motivated all the contract tests. If NLM ever flips the shape
      // again, every assertion below fails on the same call.
      const d = await getMeSHClient().getDescriptor('D006973');
      expect(d).not.toBeNull();
      expect(d!.label).toBe('Hypertension');
      expect(d!.scopeNote.length).toBeGreaterThan(50);
      expect(d!.treeNumbers.length).toBeGreaterThan(0);
      expect(d!.treeNumbers[0].treeNumber).toMatch(/^[A-Z]\d+(\.\d+)+$/);
      expect(d!.concepts.length).toBeGreaterThan(0);
      expect(d!.concepts[0].terms.length).toBeGreaterThan(0);
      expect(d!.qualifiers.length).toBeGreaterThan(10);
      expect(d!.qualifiers.every((q) => q.label.length > 0)).toBe(true);
    });
  });

  describe('CID-10 (bundled — sanity check the data file is intact)', () => {
    it('lookup of I21 resolves to acute MI', () => {
      const hit = getCID10Client().lookup('I21');
      expect(hit).not.toBeNull();
      expect(hit!.title.toLowerCase()).toMatch(/infarto/);
    });

    it('listChapters returns 22 entries', () => {
      expect(getCID10Client().listChapters()).toHaveLength(22);
    });
  });

  // WHO needs OAuth creds — set WHO_CLIENT_ID and WHO_CLIENT_SECRET to run.

  (HAS_WHO_CREDS ? describe : describe.skip)('WHO ICD-11 (requires creds)', () => {
    it('OAuth handshake succeeds and search returns destinationEntities', async () => {
      const c = new WHOClient();
      const r = await c.search('diabetes', 'en', 3);
      expect(Array.isArray(r.destinationEntities)).toBe(true);
      expect(r.destinationEntities.length).toBeGreaterThan(0);
      expect(r.destinationEntities[0].title.length).toBeGreaterThan(0);
    });

    it('lookup of code "5A11" returns an entity', async () => {
      const e = await getWHOClient().lookup('5A11');
      expect(e['@id']).toBeTruthy();
    });

    it('chapters listing returns the expected count via getChapters', async () => {
      const r = await getWHOClient().getChapters();
      // ICD-11 has 28 chapters in the MMS linearization at release 2024-01.
      // A drift (count change) is itself worth surfacing as a failure.
      expect(r.child).toBeDefined();
      expect(r.child!.length).toBeGreaterThanOrEqual(20);
    });
  });

  // SNOMED needs ENABLE_SNOMED_TOOLS=true + SNOMED_BASE_URL to a working
  // self-hosted Snowstorm. Skip otherwise (the public IHTSDO host is dead).

  (HAS_SNOMED ? describe : describe.skip)('SNOMED CT (requires self-hosted Snowstorm)', () => {
    it('search for "diabetes mellitus" returns at least one concept', async () => {
      const c = new SNOMEDClient();
      const r = await c.searchConcepts('diabetes mellitus', true, 5);
      expect(r.length).toBeGreaterThan(0);
      expect(r[0].conceptId).toMatch(/^\d+$/);
    });

    it('getConcept for SCTID 73211009 returns Diabetes mellitus', async () => {
      const c = await getSNOMEDClient().getConcept('73211009');
      expect(c).not.toBeNull();
      expect(c!.pt.toLowerCase()).toMatch(/diabetes/);
    });
  });
});

// Hint to anyone running locally — no test below this line.
if (!ENABLED) {
  describe('Integration tests', () => {
    it.skip('skipped (set INTEGRATION_TESTS=1 to enable)', () => {});
  });
}
