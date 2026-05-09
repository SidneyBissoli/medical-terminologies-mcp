/**
 * Contract tests for RxNormClient and the ATC additions.
 *
 * Pin parsers against the actual NLM RxNav response shapes captured
 * live in src/__fixtures__/rxnorm/. Covers both classic RxNorm methods
 * and the newly added ATC trio (atc_classify / atc_lookup /
 * atc_members) — the atc_members case in particular caught a real
 * 400 during implementation when extra params were sent that RxClass
 * rejects, so it's worth pinning.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nock from 'nock';
import { RxNormClient } from './rxnorm-client.js';
import { cache } from '../utils/cache.js';

const FIXTURES = join(process.cwd(), 'src', '__fixtures__', 'rxnorm');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixture(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

const HOST = 'https://rxnav.nlm.nih.gov';
const BASE = '/REST';

describe('RxNormClient — contract tests against captured live fixtures', () => {
  let client: RxNormClient;

  beforeEach(() => {
    cache.flush();
    client = new RxNormClient();
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('searchDrugs', () => {
    it('flattens drugGroup.conceptGroup[].conceptProperties[] into a single drug list', async () => {
      nock(HOST).get(`${BASE}/drugs.json`).query({ name: 'metformin' }).reply(200, fixture('drugs-metformin.json'));

      const r = await client.searchDrugs('metformin');
      expect(r.drugs.length).toBeGreaterThan(10);
      // /drugs.json returns clinical-drug term types (SBD, SCD, BPCK,
      // GPCK) — not the ingredient-level IN. Every entry should at least
      // contain "metformin" in the name.
      const ttys = new Set(r.drugs.map((d) => d.tty));
      expect(ttys.size).toBeGreaterThan(1);
      expect(r.drugs.every((d) => d.name.toLowerCase().includes('metformin'))).toBe(true);
    });

    it('returns empty drugs list when API returns null drugGroup', async () => {
      nock(HOST).get(`${BASE}/drugs.json`).query(true).reply(200, { drugGroup: {} });
      const r = await client.searchDrugs('zzz_no_match');
      expect(r.drugs).toEqual([]);
    });
  });

  describe('getApproximateMatch', () => {
    it('parses approximateGroup.candidate[] with score/rank as integers', async () => {
      nock(HOST)
        .get(`${BASE}/approximateTerm.json`)
        .query(true)
        .reply(200, fixture('approximate-metfrmin.json'));

      const r = await client.getApproximateMatch('metfrmin', 5);
      expect(r.length).toBeGreaterThan(0);
      const top = r[0];
      expect(top.rxcui).toBeTruthy();
      expect(typeof top.score).toBe('number');
      expect(typeof top.rank).toBe('number');
      // Score is parsed from string in the upstream response — assert it
      // didn't fall back to 0 silently.
      expect(top.score).toBeGreaterThan(0);
    });
  });

  describe('getConcept', () => {
    it('returns properties + status when both endpoints respond', async () => {
      nock(HOST).get(`${BASE}/rxcui/161/properties.json`).reply(200, fixture('properties-161.json'));
      nock(HOST).get(`${BASE}/rxcui/161/status.json`).reply(200, { rxcuiStatus: { status: 'Active' } });

      const c = await client.getConcept('161');
      expect(c).not.toBeNull();
      expect(c!.rxcui).toBe('161');
      expect(c!.name).toBe('acetaminophen');
      expect(c!.tty).toBe('IN');
      expect(c!.status).toBe('Active');
    });

    it('returns properties without status when /status.json 404s (current upstream behavior)', async () => {
      // Live observation 2026-05-09: /status.json returns 404 for many
      // ingredient-level RxCUIs. The client wraps the call in try/catch
      // and falls back to a default Active status. Pin that.
      nock(HOST).get(`${BASE}/rxcui/161/properties.json`).reply(200, fixture('properties-161.json'));
      // The 404 will be retried by withRetry — allow it 3x (initial + 2 retries).
      nock(HOST).get(`${BASE}/rxcui/161/status.json`).times(3).reply(404, '');

      const c = await client.getConcept('161');
      expect(c).not.toBeNull();
      expect(c!.rxcui).toBe('161');
      // Default fallback when status was unavailable.
      expect(c!.status).toBe('Active');
    });

    it('returns null when /properties.json 404s (concept does not exist)', async () => {
      nock(HOST).get(`${BASE}/rxcui/99999999/properties.json`).reply(404, '');

      const c = await client.getConcept('99999999');
      expect(c).toBeNull();
    });
  });

  describe('getIngredients', () => {
    it('flattens relatedGroup.conceptGroup[].conceptProperties[] tagging IN vs MIN', async () => {
      nock(HOST)
        .get(`${BASE}/rxcui/6809/related.json`)
        .query({ tty: 'IN+MIN' })
        .reply(200, fixture('related-6809-ingredients.json'));

      const ings = await client.getIngredients('6809');
      expect(ings.length).toBeGreaterThan(0);
      // For the metformin RxCUI, the response includes itself (IN).
      const metformin = ings.find((i) => i.name === 'metformin');
      expect(metformin).toBeDefined();
      expect(metformin!.isMultiple).toBe(false);
    });
  });

  describe('getDrugClasses', () => {
    it('extracts classId/className/classType across all relaSource families', async () => {
      nock(HOST)
        .get(`${BASE}/rxclass/class/byRxcui.json`)
        .query({ rxcui: '6809' })
        .reply(200, fixture('classes-byrxcui-6809.json'));

      const classes = await client.getDrugClasses('6809');
      expect(classes.length).toBeGreaterThan(0);
      // The captured response covers ATC, EPC, MoA, etc. — the parser
      // returns all in one flat list.
      const classTypes = new Set(classes.map((c) => c.classType));
      expect(classTypes.size).toBeGreaterThan(1);
    });

    it('returns [] when rxclassDrugInfoList is missing', async () => {
      nock(HOST).get(`${BASE}/rxclass/class/byRxcui.json`).query(true).reply(200, {});
      expect(await client.getDrugClasses('99999999')).toEqual([]);
    });
  });

  describe('getNDCs and getRxcuiByNDC', () => {
    it('returns [] for ingredient-level RxCUI (no NDCs)', async () => {
      nock(HOST)
        .get(`${BASE}/rxcui/161/allndcs.json`)
        .query({ history: 0 })
        .reply(200, fixture('ndcs-161.json'));

      const ndcs = await client.getNDCs('161');
      expect(ndcs).toEqual([]);
    });

    it('extracts rxcui from ndcStatus shape (synthetic populated fixture)', async () => {
      // The live /ndcstatus.json endpoint returns an UNKNOWN status with
      // empty rxcui for many NDCs (verified 2026-05-09 — captured in
      // ndcstatus.json fixture); a synthetic populated payload exercises
      // the happy path the parser is supposed to handle.
      nock(HOST)
        .get(`${BASE}/ndcstatus.json`)
        .query({ ndc: '12345-6789' })
        .reply(200, {
          ndcStatus: {
            ndc11: '12345067890',
            status: 'ACTIVE',
            rxcui: '198440',
            conceptName: 'fictional drug',
          },
        });

      const rxcui = await client.getRxcuiByNDC('12345-6789');
      expect(rxcui).toBe('198440');
    });

    it('returns null when ndcStatus.rxcui is empty (live UNKNOWN-status case)', async () => {
      nock(HOST)
        .get(`${BASE}/ndcstatus.json`)
        .query(true)
        .reply(200, fixture('ndcstatus.json'));

      expect(await client.getRxcuiByNDC('00378-1402')).toBeNull();
    });

    it('returns null when ndcStatus is absent', async () => {
      nock(HOST).get(`${BASE}/ndcstatus.json`).query(true).reply(200, {});
      expect(await client.getRxcuiByNDC('0000-0000-00')).toBeNull();
    });
  });

  // ===========================================================================
  // ATC tests
  // ===========================================================================

  describe('getATCByDrugName', () => {
    it('parses byDrugName response with relaSource=ATC, surfaces minConcept + class fields', async () => {
      nock(HOST)
        .get(`${BASE}/rxclass/class/byDrugName.json`)
        .query({ drugName: 'metformin', relaSource: 'ATC' })
        .reply(200, fixture('atc-bydrug-metformin.json'));

      const matches = await client.getATCByDrugName('metformin');
      expect(matches.length).toBeGreaterThan(0);
      const first = matches[0];
      expect(first.rxcui).toBeTruthy();
      expect(first.drug_name).toBeTruthy();
      expect(first.tty).toBeTruthy();
      expect(first.atc_code).toMatch(/^[A-V]/);
      expect(first.atc_name).toBeTruthy();
      expect(first.atc_level_type).toBe('ATC1-4');
    });

    it('returns [] when the drug has no ATC mapping', async () => {
      nock(HOST)
        .get(`${BASE}/rxclass/class/byDrugName.json`)
        .query(true)
        .reply(200, { rxclassDrugInfoList: {} });

      const matches = await client.getATCByDrugName('zzz_unknown');
      expect(matches).toEqual([]);
    });
  });

  describe('getATCByCode', () => {
    it('resolves an ATC1-4 code (A10BA = Biguanides) via byId', async () => {
      nock(HOST)
        .get(`${BASE}/rxclass/class/byId.json`)
        .query({ classId: 'A10BA' })
        .reply(200, fixture('atc-byid-A10BA.json'));

      const c = await client.getATCByCode('A10BA');
      expect(c).not.toBeNull();
      expect(c!.atc_code).toBe('A10BA');
      expect(c!.atc_name).toBe('Biguanides');
      expect(c!.atc_level_type).toBe('ATC1-4');
    });

    it('returns null for substance-level codes (RxClass byId only knows ATC1-4)', async () => {
      // Live verification 2026-05-09: byId returns `{}` for 7-char
      // substance codes like A10BA02 — they're only retrievable via
      // byDrugName. The tool description warns about this; the client
      // surfaces it as null.
      nock(HOST)
        .get(`${BASE}/rxclass/class/byId.json`)
        .query({ classId: 'A10BA02' })
        .reply(200, fixture('atc-byid-A10BA02-empty.json'));

      const c = await client.getATCByCode('A10BA02');
      expect(c).toBeNull();
    });

    it('returns null on 404', async () => {
      nock(HOST)
        .get(`${BASE}/rxclass/class/byId.json`)
        .query({ classId: 'XXXXX' })
        .reply(404, '');
      expect(await client.getATCByCode('XXXXX')).toBeNull();
    });
  });

  describe('getATCMembers', () => {
    it('extracts SourceId from nodeAttr as source_atc_code', async () => {
      // Critical: this endpoint rejects extra params (like rela=isa_atc
      // or ttys=IN+MIN+PIN) with HTTP 400. Tests must mirror the
      // exact same param set the client sends — `classId` and
      // `relaSource=ATC`, nothing else.
      nock(HOST)
        .get(`${BASE}/rxclass/classMembers.json`)
        .query({ classId: 'A10BA', relaSource: 'ATC' })
        .reply(200, fixture('atc-members-A10BA.json'));

      const members = await client.getATCMembers('A10BA');
      expect(members.length).toBe(2);
      const codes = members.map((m) => m.source_atc_code).sort();
      expect(codes).toEqual(['A10BA01', 'A10BA02']);
      const names = members.map((m) => m.name).sort();
      expect(names).toEqual(['metformin', 'phenformin']);
    });

    it('returns empty array when class has no members', async () => {
      nock(HOST)
        .get(`${BASE}/rxclass/classMembers.json`)
        .query(true)
        .reply(200, { drugMemberGroup: {} });

      expect(await client.getATCMembers('A10BA')).toEqual([]);
    });
  });
});
