import { describe, it, expect } from 'vitest';
import {
  // input schemas — strict validators (the "dead schema" finding from the audit)
  ICD11LookupParamsSchema,
  ICD11SearchParamsSchema,
  LOINCByCodeParamsSchema,
  SNOMEDBySctidParamsSchema,
  MeSHByIdParamsSchema,
  RxNormConceptParamsSchema,
  RxNormNDCParamsSchema,
  FindEquivalentParamsSchema,
  // output schemas — established as a pattern by the ICD-11 commit
  ICD11SearchOutputSchema,
  ICD11LookupOutputSchema,
  ICD11HierarchyOutputSchema,
  ICD11ChaptersOutputSchema,
  ICD11PostcoordinationOutputSchema,
} from './index.js';

describe('input param schemas — strict validators run', () => {
  describe('LOINC code format', () => {
    it.each([
      ['2339-0', true],
      ['718-7', true],
      ['39156-5', true],
      ['abc', false],
      ['2339', false],
      ['2339-X', false],
      ['', false],
      ['12345-9', true],
      ['123456-7', false], // > 5 digits before dash
    ])('loinc_num "%s" → valid=%s', (input, expected) => {
      const result = LOINCByCodeParamsSchema.safeParse({ loinc_num: input });
      expect(result.success).toBe(expected);
    });
  });

  describe('SCTID numeric format', () => {
    it.each([
      ['73211009', true],
      ['1', true],
      ['abc', false],
      ['73211-009', false],
      ['73211 009', false],
      ['', false],
    ])('sctid "%s" → valid=%s', (input, expected) => {
      const result = SNOMEDBySctidParamsSchema.safeParse({ sctid: input });
      expect(result.success).toBe(expected);
    });
  });

  describe('MeSH descriptor ID', () => {
    it.each([
      ['D015242', true],
      ['D003920', true],
      ['D1', true],
      ['X1', false],
      ['015242', false], // missing D
      ['Dabc', false],
      ['', false],
    ])('mesh_id "%s" → valid=%s', (input, expected) => {
      const result = MeSHByIdParamsSchema.safeParse({ mesh_id: input });
      expect(result.success).toBe(expected);
    });
  });

  describe('RxCUI numeric format', () => {
    it.each([
      ['1', true],
      ['6809', true],
      ['aspirin', false],
      ['68-09', false],
    ])('rxcui "%s" → valid=%s', (input, expected) => {
      const result = RxNormConceptParamsSchema.safeParse({ rxcui: input });
      expect(result.success).toBe(expected);
    });
  });

  describe('ICD-11 lookup refine: code OR uri required', () => {
    it('rejects empty input', () => {
      const r = ICD11LookupParamsSchema.safeParse({});
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.errors[0].message).toMatch(/code.*or.*uri/i);
      }
    });

    it('accepts code only', () => {
      expect(ICD11LookupParamsSchema.safeParse({ code: 'BA00' }).success).toBe(true);
    });

    it('accepts uri only', () => {
      expect(
        ICD11LookupParamsSchema.safeParse({
          uri: 'http://id.who.int/icd/entity/1234',
        }).success,
      ).toBe(true);
    });

    it('rejects malformed uri (non-URL string)', () => {
      expect(ICD11LookupParamsSchema.safeParse({ uri: 'not-a-url' }).success).toBe(false);
    });
  });

  describe('RxNorm NDC refine: rxcui OR ndc required', () => {
    it('rejects empty input', () => {
      expect(RxNormNDCParamsSchema.safeParse({}).success).toBe(false);
    });

    it('accepts rxcui only', () => {
      expect(RxNormNDCParamsSchema.safeParse({ rxcui: '6809' }).success).toBe(true);
    });

    it('accepts ndc only', () => {
      expect(
        RxNormNDCParamsSchema.safeParse({ ndc: '00093-0058-01' }).success,
      ).toBe(true);
    });
  });

  describe('defaults are applied', () => {
    it('ICD-11 search: language defaults to "en", max_results defaults to 25', () => {
      const r = ICD11SearchParamsSchema.parse({ query: 'diabetes' });
      expect(r.language).toBe('en');
      expect(r.max_results).toBe(25);
    });

    it('find_equivalent: target_terminologies optional, source_terminology optional', () => {
      const r = FindEquivalentParamsSchema.parse({ term: 'diabetes' });
      expect(r.term).toBe('diabetes');
      expect(r.target_terminologies).toBeUndefined();
      expect(r.source_terminology).toBeUndefined();
    });

    it('find_equivalent: rejects unknown terminology values', () => {
      const r = FindEquivalentParamsSchema.safeParse({
        term: 'x',
        source_terminology: 'icd99',
      });
      expect(r.success).toBe(false);
    });
  });
});

describe('ICD-11 output schemas — fixtures parse cleanly', () => {
  it('search output: typical hit', () => {
    const sample = {
      query: 'diabetes',
      total_count: 25,
      entities: [
        {
          code: '5A11',
          title: 'Type 2 diabetes mellitus',
          score: 0.91,
          uri: 'http://id.who.int/icd/entity/123',
          is_leaf: true,
          matching_pvs: [
            {
              property_id: 'Title',
              label: 'Type 2 diabetes mellitus',
              score: 0.91,
              important: true,
            },
          ],
        },
      ],
    };
    expect(ICD11SearchOutputSchema.safeParse(sample).success).toBe(true);
  });

  it('search output: empty result', () => {
    expect(
      ICD11SearchOutputSchema.safeParse({
        query: 'zzz',
        total_count: 0,
        entities: [],
      }).success,
    ).toBe(true);
  });

  it('search output: rejects entity without is_leaf', () => {
    const sample = {
      query: 'x',
      total_count: 1,
      entities: [
        {
          code: '5A11',
          title: 't',
          score: 0.5,
          uri: 'http://...',
          // is_leaf missing
          matching_pvs: [],
        },
      ],
    };
    expect(ICD11SearchOutputSchema.safeParse(sample).success).toBe(false);
  });

  it('lookup output: minimal block-level entity (most fields null)', () => {
    expect(
      ICD11LookupOutputSchema.safeParse({
        code: null,
        code_range: '1A00-1A40',
        uri: 'http://id.who.int/icd/entity/x',
        title: 'Some block',
        class_kind: 'block',
        block_id: 'BlockL1',
        definition: null,
        long_definition: null,
        diagnostic_criteria: null,
        coding_note: null,
        exclusions: [],
        inclusions: [],
        index_terms: [],
        browser_url: null,
      }).success,
    ).toBe(true);
  });

  it('lookup output: rejects undefined where null is required (nullable, not optional)', () => {
    const incomplete = {
      code: '5A11',
      uri: 'http://...',
      title: 'Diabetes',
      // class_kind missing entirely (should fail because schema has it as nullable, not optional)
    };
    expect(ICD11LookupOutputSchema.safeParse(incomplete).success).toBe(false);
  });

  it('hierarchy output: parents direction', () => {
    expect(
      ICD11HierarchyOutputSchema.safeParse({
        code: '5A11',
        direction: 'parents',
        entities: [
          { code: '5A1', code_range: null, title: 'Diabetes mellitus', uri: 'http://...' },
        ],
      }).success,
    ).toBe(true);
  });

  it('hierarchy output: rejects unknown direction', () => {
    expect(
      ICD11HierarchyOutputSchema.safeParse({
        code: '5A11',
        direction: 'siblings',
        entities: [],
      }).success,
    ).toBe(false);
  });

  it('chapters output: mix of OK and error per item — cardinality preserved', () => {
    expect(
      ICD11ChaptersOutputSchema.safeParse({
        chapters: [
          {
            number: 1,
            uri: 'u1',
            code: '01',
            code_range: null,
            title: 'Infectious',
            error: null,
          },
          {
            number: 2,
            uri: 'u2',
            code: null,
            code_range: null,
            title: null,
            error: 'Network timeout',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('postcoordination output: empty axes', () => {
    expect(
      ICD11PostcoordinationOutputSchema.safeParse({ code: '5A11', axes: [] }).success,
    ).toBe(true);
  });

  it('postcoordination output: required + allow_multiple booleans', () => {
    expect(
      ICD11PostcoordinationOutputSchema.safeParse({
        code: '5A11',
        axes: [
          { axis_name: 'severity', required: false, allow_multiple: false, value_count: 5 },
          {
            axis_name: 'temporality',
            required: true,
            allow_multiple: true,
            value_count: null,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
