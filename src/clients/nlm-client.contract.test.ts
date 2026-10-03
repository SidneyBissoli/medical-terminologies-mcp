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
    // Live fixtures captured 2026-10-03. Until 1.18.2 this block replayed an
    // INVENTED shape ({ AnswerListId, Sequence }) that matched the client's own
    // wrong field names, so the test confirmed the defect instead of catching
    // it: every real answer came back with an empty code and sequence 0.
    it('parses the live shape: LA code, text, order (72166-2, smoking status)', async () => {
      nock(CLINICAL_HOST)
        .get('/loinc_answers')
        .query({ loinc_num: '72166-2' })
        .reply(200, fixture('loinc-answers-72166-2.json'));

      const answers = await client.getLOINCAnswers('72166-2');
      expect(answers).toHaveLength(8);
      expect(answers[0]).toEqual({
        answerCode: 'LA18976-3',
        answerString: 'Current every day smoker',
        sequence: 1,
        score: null,
      });
      // No empty code and no zero sequence anywhere — the old symptom.
      expect(answers.every((a) => /^LA\d+-\d$/.test(a.answerCode))).toBe(true);
      expect(answers.map((a) => a.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('keeps the score of a scored instrument (44250-9, PHQ-9 item)', async () => {
      nock(CLINICAL_HOST)
        .get('/loinc_answers')
        .query({ loinc_num: '44250-9' })
        .reply(200, fixture('loinc-answers-44250-9-scored.json'));

      const answers = await client.getLOINCAnswers('44250-9');
      expect(answers.map((a) => a.score)).toEqual([0, 1, 2, 3]);
      expect(answers[0]).toMatchObject({ answerCode: 'LA6568-5', answerString: 'Not at all' });
    });

    it('returns [] on 404 (no answer list, or unknown code — the endpoint does not tell them apart)', async () => {
      nock(CLINICAL_HOST)
        .get('/loinc_answers')
        .query({ loinc_num: '2339-0' })
        .reply(404, '');

      expect(await client.getLOINCAnswers('2339-0')).toEqual([]);
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

    it('numbers items by form position and leaves `required` null — the live form states neither (44249-1, PHQ-9)', async () => {
      // Captured 2026-10-03. Until 1.18.2 the client read `displayOrder` and
      // `required`, absent from this shape: every item got sequence 0 and a
      // made-up required:false.
      nock(CLINICAL_HOST)
        .get('/loinc_form_definitions')
        .query({ loinc_num: '44249-1' })
        .reply(200, fixture('loinc-panel-44249-1.json'));

      const panel = await client.getLOINCPanel('44249-1');
      expect(panel!.items).toHaveLength(11);
      expect(panel!.items.map((i) => i.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(panel!.items[0]).toMatchObject({ loincNum: '44250-9', name: 'Little interest or pleasure in doing things' });
      expect(panel!.items.every((i) => i.required === null)).toBe(true);
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
