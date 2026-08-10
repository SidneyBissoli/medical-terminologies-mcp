/**
 * Contract tests for NLMClient (LOINC endpoints).
 *
 * Pin the parser against the actual NLM Clinical Tables tabular
 * response shape, captured live in src/__fixtures__/nlm/. The shape is
 * unusual — `[totalCount, codes, extraFieldsObjOrNull, displayFieldsArr]`
 * — and any change to it (or the row-by-row column ordering inside
 * `displayFieldsArr`) silently miscolumns every output field.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nock from 'nock';
import { NLMClient } from './nlm-client.js';
import { cache } from '../utils/cache.js';

const FIXTURES = join(process.cwd(), 'src', '__fixtures__', 'nlm');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixture(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

const CLINICAL_HOST = 'https://clinicaltables.nlm.nih.gov';

describe('NLMClient — contract tests against captured live fixtures', () => {
  let client: NLMClient;

  beforeEach(() => {
    cache.flush();
    client = new NLMClient();
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('searchLOINC', () => {
    it('parses [total, codes, null, displayFields] with df-only request', async () => {
      nock(CLINICAL_HOST)
        .get('/api/loinc_items/v3/search')
        .query(true)
        .reply(200, fixture('loinc-search-glucose.json'));

      const r = await client.searchLOINC('glucose', 3);

      expect(r.totalCount).toBe(1024);
      expect(r.items).toHaveLength(3);
      expect(r.items[0]).toEqual(
        expect.objectContaining({
          LOINC_NUM: '74790-7',
          LONG_COMMON_NAME: 'Glucose challenge (hydrogen breath test) panel - Exhaled gas',
          COMPONENT: 'Glucose challenge panel',
        }),
      );
    });

    it('field index alignment is locked to DEFAULT_LOINC_FIELDS order', async () => {
      // If the server ever switches column order on us, this catches it
      // because we hardcoded an exact-order display fields row.
      nock(CLINICAL_HOST)
        .get('/api/loinc_items/v3/search')
        .query(true)
        .reply(200, [
          1,
          ['T-1'],
          null,
          [
            [
              'T-1', // LOINC_NUM       (df[0])
              'long-name', // LONG_COMMON_NAME (df[1])
              'component', // COMPONENT       (df[2])
              'property', // PROPERTY        (df[3])
              'time', // TIME_ASPCT      (df[4])
              'system', // SYSTEM          (df[5])
              'scale', // SCALE_TYP       (df[6])
              'method', // METHOD_TYP      (df[7])
              'class', // CLASS           (df[8])
              'status', // STATUS          (df[9])
              'short-name', // SHORTNAME       (df[10])
            ],
          ],
        ]);

      const r = await client.searchLOINC('test', 1);
      expect(r.items[0]).toEqual({
        LOINC_NUM: 'T-1',
        EXTERNAL_COPYRIGHT_NOTICE: '',
        LONG_COMMON_NAME: 'long-name',
        COMPONENT: 'component',
        PROPERTY: 'property',
        TIME_ASPCT: 'time',
        SYSTEM: 'system',
        SCALE_TYP: 'scale',
        METHOD_TYP: 'method',
        CLASS: 'class',
        STATUS: 'status',
        SHORTNAME: 'short-name',
      });
    });

    it('empty result: total=0, no items', async () => {
      nock(CLINICAL_HOST)
        .get('/api/loinc_items/v3/search')
        .query(true)
        .reply(200, fixture('loinc-search-empty.json'));

      const r = await client.searchLOINC('zzz_no_match', 5);
      expect(r.totalCount).toBe(0);
      expect(r.items).toEqual([]);
    });
  });

  describe('getLOINCDetails', () => {
    it('finds the exact match even when not first in ranked results', async () => {
      // Synthesize a response where the exact code is in position 2
      // (other LOINCs ranked higher on textual relevance). Pre-fix
      // (maxList=1), this would null-return; the fix is supposed to
      // fetch up to 10 and findIndex.
      nock(CLINICAL_HOST)
        .get('/api/loinc_items/v3/search')
        .query(true)
        .reply(200, [
          3,
          ['noise-1', 'noise-2', '2339-0'],
          {},
          [
            ['noise-1', 'unrelated', 'comp', 'prop', 'time', 'sys', 'scale', 'meth', 'cls', 'st', 'sh'],
            ['noise-2', 'unrelated2', 'comp', 'prop', 'time', 'sys', 'scale', 'meth', 'cls', 'st', 'sh'],
            ['2339-0', 'Glucose [Mass/volume] in Serum or Plasma', 'Glucose', 'MCnc', 'Pt', 'Ser/Plas', 'Qn', '', 'CHEM', 'ACTIVE', 'Glucose SerPl-mCnc'],
          ],
        ]);

      const item = await client.getLOINCDetails('2339-0');
      expect(item).not.toBeNull();
      expect(item!.LOINC_NUM).toBe('2339-0');
      expect(item!.LONG_COMMON_NAME).toBe('Glucose [Mass/volume] in Serum or Plasma');
    });

    it('returns null when the code does not appear in results', async () => {
      nock(CLINICAL_HOST)
        .get('/api/loinc_items/v3/search')
        .query(true)
        .reply(200, [
          2,
          ['other-1', 'other-2'],
          {},
          [
            ['other-1', 'X', 'C', 'P', 'T', 'S', 'Sc', 'M', 'Cl', 'St', 'Sh'],
            ['other-2', 'Y', 'C', 'P', 'T', 'S', 'Sc', 'M', 'Cl', 'St', 'Sh'],
          ],
        ]);

      const item = await client.getLOINCDetails('99999-9');
      expect(item).toBeNull();
    });

    it('returns null on totalCount=0', async () => {
      nock(CLINICAL_HOST)
        .get('/api/loinc_items/v3/search')
        .query(true)
        .reply(200, [0, [], null, []]);

      expect(await client.getLOINCDetails('99999-9')).toBeNull();
    });

    it('parses the live fixture (LOINC 2339-0 = Glucose) end-to-end', async () => {
      // The captured live fixture for 2339-0 only has the first 4
      // df-fields populated (LOINC_NUM, LONG_COMMON_NAME, COMPONENT,
      // PROPERTY) — TIME_ASPCT, SYSTEM, etc. come back empty from the
      // current Clinical Tables index. We assert what's actually
      // present, which catches both column-shift bugs and bugs in our
      // empty-string fallback.
      nock(CLINICAL_HOST)
        .get('/api/loinc_items/v3/search')
        .query(true)
        .reply(200, fixture('loinc-details-2339-0.json'));

      const item = await client.getLOINCDetails('2339-0');
      expect(item).not.toBeNull();
      expect(item!.LOINC_NUM).toBe('2339-0');
      expect(item!.LONG_COMMON_NAME).toMatch(/glucose/i);
      expect(item!.COMPONENT).toBe('Glucose');
      expect(item!.PROPERTY).toBe('MCnc');
      expect(item!.SHORTNAME).toBe('Glucose Bld-mCnc');
    });

    it('passes the EXTERNAL_COPYRIGHT_NOTICE through verbatim (LOINC License §10)', async () => {
      // Captured live 2026-08-09: PHQ-9 (44249-1) is the canonical LOINC
      // term with a third-party copyright (Pfizer). The notice comes back
      // in the ef slot (response index 2) and must be served verbatim.
      nock(CLINICAL_HOST)
        .get('/api/loinc_items/v3/search')
        .query(true)
        .reply(200, fixture('loinc-details-44249-1-copyright.json'));

      const item = await client.getLOINCDetails('44249-1');
      expect(item).not.toBeNull();
      expect(item!.LOINC_NUM).toBe('44249-1');
      expect(item!.EXTERNAL_COPYRIGHT_NOTICE).toMatch(/^Copyright © Pfizer Inc\./);
    });
  });

  describe('getLOINCAnswers', () => {
    // The /loinc_answers endpoint at clinicaltables.nlm.nih.gov returns
    // HTTP 404 in production (verified 2026-05-09 — see the marker file
    // src/__fixtures__/nlm/loinc-answers-deprecated.json). The client
    // catches that 404 and returns [], which the tool surfaces as "no
    // answers available". This test pins that fallback so a future
    // contributor doesn't accidentally turn the catch into a throw.
    it('returns [] on 404 (current upstream behavior)', async () => {
      nock(CLINICAL_HOST)
        .get('/loinc_answers')
        .query({ loinc_num: '44249-1' })
        .reply(404, '');

      const answers = await client.getLOINCAnswers('44249-1');
      expect(answers).toEqual([]);
    });

    it('parses populated array shape (in case the endpoint comes back)', async () => {
      nock(CLINICAL_HOST)
        .get('/loinc_answers')
        .query({ loinc_num: '38208-5' })
        .reply(200, [
          { AnswerListId: 'LL370-5', DisplayText: 'Yes', Sequence: 1 },
          { AnswerListId: 'LL370-5', DisplayText: 'No', Sequence: 2 },
        ]);

      const answers = await client.getLOINCAnswers('38208-5');
      expect(answers).toHaveLength(2);
      expect(answers[0]).toEqual({ answerCode: 'LL370-5', answerString: 'Yes', sequence: 1 });
    });
  });

  describe('getLOINCPanel', () => {
    it('parses panel structure with member items', async () => {
      nock(CLINICAL_HOST)
        .get('/loinc_form_definitions')
        .query({ loinc_num: '24331-1' })
        .reply(200, fixture('loinc-panel-24331-1.json'));

      const panel = await client.getLOINCPanel('24331-1');
      expect(panel).not.toBeNull();
      expect(panel!.loincNum).toBe('24331-1');
      expect(panel!.name).toBeTruthy();
    });

    it('returns null on 404', async () => {
      nock(CLINICAL_HOST)
        .get('/loinc_form_definitions')
        .query({ loinc_num: '99999-9' })
        .reply(404, '');

      expect(await client.getLOINCPanel('99999-9')).toBeNull();
    });

    it('returns null when the form has no items', async () => {
      nock(CLINICAL_HOST)
        .get('/loinc_form_definitions')
        .query(true)
        .reply(200, { name: 'X', items: [] });

      expect(await client.getLOINCPanel('1-1')).toBeNull();
    });
  });
});
