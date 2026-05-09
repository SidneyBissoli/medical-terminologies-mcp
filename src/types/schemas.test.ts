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
  ATCByCodeParamsSchema,
  ATCMembersParamsSchema,
  CID10LookupParamsSchema,
  CID10ChapterParamsSchema,
  // output schemas — established as a pattern by the ICD-11 commit
  ICD11SearchOutputSchema,
  ICD11LookupOutputSchema,
  ICD11HierarchyOutputSchema,
  ICD11ChaptersOutputSchema,
  ICD11PostcoordinationOutputSchema,
  LOINCSearchOutputSchema,
  LOINCDetailsOutputSchema,
  LOINCAnswersOutputSchema,
  LOINCPanelsOutputSchema,
  MeSHSearchOutputSchema,
  MeSHDescriptorOutputSchema,
  MeSHTreeOutputSchema,
  MeSHQualifiersOutputSchema,
  SNOMEDSearchOutputSchema,
  SNOMEDConceptOutputSchema,
  SNOMEDHierarchyOutputSchema,
  SNOMEDDescriptionsOutputSchema,
  SNOMEDECLOutputSchema,
  RxNormSearchOutputSchema,
  RxNormConceptOutputSchema,
  RxNormIngredientsOutputSchema,
  RxNormClassesOutputSchema,
  RxNormNDCOutputSchema,
  FindEquivalentOutputSchema,
  ATCClassifyOutputSchema,
  ATCLookupOutputSchema,
  ATCMembersOutputSchema,
  CID10SearchOutputSchema,
  CID10LookupOutputSchema,
  CID10ChaptersOutputSchema,
  CID10ChapterDetailOutputSchema,
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

describe('LOINC output schemas — fixtures parse cleanly', () => {
  const sampleItem = {
    loinc_num: '2339-0',
    long_common_name: 'Glucose [Mass/volume] in Blood',
    short_name: 'Glucose Bld-mCnc',
    component: 'Glucose',
    property: 'MCnc',
    time_aspect: 'Pt',
    system: 'Bld',
    scale_type: 'Qn',
    method_type: '',
    class: 'CHEM',
    status: 'ACTIVE',
  };

  it('search output: typical hit', () => {
    expect(
      LOINCSearchOutputSchema.safeParse({
        query: 'glucose',
        total_count: 152,
        shown_count: 1,
        items: [sampleItem],
      }).success,
    ).toBe(true);
  });

  it('search output: empty result still has shape', () => {
    expect(
      LOINCSearchOutputSchema.safeParse({
        query: 'zzz',
        total_count: 0,
        shown_count: 0,
        items: [],
      }).success,
    ).toBe(true);
  });

  it('details output: single item', () => {
    expect(LOINCDetailsOutputSchema.safeParse(sampleItem).success).toBe(true);
  });

  it('details output: rejects missing required field', () => {
    const broken: Record<string, unknown> = { ...sampleItem };
    delete broken.long_common_name;
    expect(LOINCDetailsOutputSchema.safeParse(broken).success).toBe(false);
  });

  it('answers output: list of answers', () => {
    expect(
      LOINCAnswersOutputSchema.safeParse({
        loinc_num: '44249-1',
        answers: [
          { sequence: 1, answer_code: 'LA6568-5', answer_string: 'Not at all' },
          { sequence: 2, answer_code: 'LA6569-3', answer_string: 'Several days' },
        ],
      }).success,
    ).toBe(true);
  });

  it('answers output: empty answer list still valid', () => {
    expect(
      LOINCAnswersOutputSchema.safeParse({ loinc_num: '2339-0', answers: [] }).success,
    ).toBe(true);
  });

  it('panels output: panel found', () => {
    expect(
      LOINCPanelsOutputSchema.safeParse({
        loinc_num: '24331-1',
        panel: {
          loinc_num: '24331-1',
          name: 'Lipid panel',
          items: [
            { sequence: 1, loinc_num: '2093-3', name: 'Cholesterol', required: true },
            { sequence: 2, loinc_num: '2571-8', name: 'Triglyceride', required: true },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it('panels output: panel null is the explicit "not a panel" signal', () => {
    expect(
      LOINCPanelsOutputSchema.safeParse({ loinc_num: '2339-0', panel: null }).success,
    ).toBe(true);
  });
});

describe('MeSH output schemas — fixtures parse cleanly', () => {
  it('search output: typical hits', () => {
    expect(
      MeSHSearchOutputSchema.safeParse({
        query: 'diabetes',
        match: 'contains',
        total_count: 2,
        descriptors: [
          { id: 'D003920', uri: 'http://id.nlm.nih.gov/mesh/D003920', label: 'Diabetes Mellitus' },
          { id: 'D003922', uri: 'http://id.nlm.nih.gov/mesh/D003922', label: 'Diabetes Mellitus, Type 2' },
        ],
      }).success,
    ).toBe(true);
  });

  it('search output: rejects unknown match value', () => {
    expect(
      MeSHSearchOutputSchema.safeParse({
        query: 'x', match: 'fuzzy', total_count: 0, descriptors: [],
      }).success,
    ).toBe(false);
  });

  it('descriptor output: full record', () => {
    expect(
      MeSHDescriptorOutputSchema.safeParse({
        id: 'D015242',
        uri: 'http://id.nlm.nih.gov/mesh/D015242',
        label: 'Ofloxacin',
        scope_note: 'A synthetic fluoroquinolone antibacterial agent...',
        tree_numbers: [
          { tree_number: 'D02.455.426.559.389.127.085.581', uri: 'http://...' },
        ],
        concepts: [
          {
            uri: 'http://id.nlm.nih.gov/mesh/M0024093',
            label: 'Ofloxacin',
            is_preferred: true,
            terms: ['Ofloxacin', 'Floxin'],
          },
        ],
        qualifiers: [
          {
            id: 'Q000008',
            uri: 'http://id.nlm.nih.gov/mesh/Q000008',
            label: 'administration & dosage',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('descriptor output: empty arrays still valid', () => {
    expect(
      MeSHDescriptorOutputSchema.safeParse({
        id: 'D000001',
        uri: 'http://...',
        label: 'something',
        scope_note: '',
        tree_numbers: [],
        concepts: [],
        qualifiers: [],
      }).success,
    ).toBe(true);
  });

  it('tree output: list of tree numbers', () => {
    expect(
      MeSHTreeOutputSchema.safeParse({
        mesh_id: 'D015242',
        tree_numbers: [
          { tree_number: 'D02.455.426.559.389.127.085.581', uri: 'http://...' },
        ],
      }).success,
    ).toBe(true);
  });

  it('qualifiers output: list of qualifiers', () => {
    expect(
      MeSHQualifiersOutputSchema.safeParse({
        mesh_id: 'D015242',
        qualifiers: [
          { id: 'Q000008', uri: 'http://...', label: 'administration & dosage' },
          { id: 'Q000009', uri: 'http://...', label: 'adverse effects' },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('SNOMED CT output schemas — fixtures parse cleanly', () => {
  const sampleSummary = {
    concept_id: '73211009',
    fsn: 'Diabetes mellitus (disorder)',
    pt: 'Diabetes mellitus',
    active: true,
    definition_status: 'PRIMITIVE',
    module_id: '900000000000207008',
  };

  it('search output: typical hits', () => {
    expect(
      SNOMEDSearchOutputSchema.safeParse({
        query: 'diabetes',
        active_only: true,
        total_count: 1,
        concepts: [sampleSummary],
      }).success,
    ).toBe(true);
  });

  it('search output: empty result still valid', () => {
    expect(
      SNOMEDSearchOutputSchema.safeParse({
        query: 'xyzzy',
        active_only: true,
        total_count: 0,
        concepts: [],
      }).success,
    ).toBe(true);
  });

  it('concept output: full record', () => {
    expect(
      SNOMEDConceptOutputSchema.safeParse({
        ...sampleSummary,
        effective_time: '20020131',
      }).success,
    ).toBe(true);
  });

  it('concept output: rejects missing effective_time (separates concept from search summary)', () => {
    expect(SNOMEDConceptOutputSchema.safeParse(sampleSummary).success).toBe(false);
  });

  it('hierarchy output: direction=both populates both arrays', () => {
    expect(
      SNOMEDHierarchyOutputSchema.safeParse({
        sctid: '73211009',
        direction: 'both',
        parents: [
          {
            concept_id: '64572001',
            fsn: 'Disease (disorder)',
            pt: 'Disease',
            active: true,
            definition_status: 'PRIMITIVE',
          },
        ],
        children: [
          {
            concept_id: '44054006',
            fsn: 'Type 2 diabetes mellitus (disorder)',
            pt: 'Type 2 diabetes mellitus',
            active: true,
            definition_status: 'PRIMITIVE',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('hierarchy output: direction=parents → children must still be present (empty array)', () => {
    expect(
      SNOMEDHierarchyOutputSchema.safeParse({
        sctid: '73211009',
        direction: 'parents',
        parents: [],
        children: [],
      }).success,
    ).toBe(true);
  });

  it('hierarchy output: rejects unknown direction', () => {
    expect(
      SNOMEDHierarchyOutputSchema.safeParse({
        sctid: '73211009',
        direction: 'siblings',
        parents: [],
        children: [],
      }).success,
    ).toBe(false);
  });

  it('descriptions output: full record with acceptability map', () => {
    expect(
      SNOMEDDescriptionsOutputSchema.safeParse({
        sctid: '73211009',
        descriptions: [
          {
            description_id: '751689012',
            term: 'Diabetes mellitus',
            type: 'SYN',
            type_id: '900000000000013009',
            lang: 'en',
            active: true,
            case_significance: 'CASE_INSENSITIVE',
            acceptability_map: {
              '900000000000509007': 'PREFERRED',
              '900000000000508004': 'ACCEPTABLE',
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('descriptions output: empty list still valid', () => {
    expect(
      SNOMEDDescriptionsOutputSchema.safeParse({
        sctid: '73211009',
        descriptions: [],
      }).success,
    ).toBe(true);
  });

  it('ecl output: typical results', () => {
    expect(
      SNOMEDECLOutputSchema.safeParse({
        ecl: '<< 73211009',
        total_count: 1,
        concepts: [sampleSummary],
      }).success,
    ).toBe(true);
  });
});

describe('RxNorm output schemas — fixtures parse cleanly', () => {
  const sampleDrug = {
    rxcui: '6809',
    name: 'metformin',
    synonym: '',
    tty: 'IN',
    language: 'ENG',
  };

  it('search output: exact match', () => {
    expect(
      RxNormSearchOutputSchema.safeParse({
        query: 'metformin',
        total_count: 1,
        drugs: [sampleDrug],
      }).success,
    ).toBe(true);
  });

  it('search output: approximate fallback signaled by tty=APPROX', () => {
    expect(
      RxNormSearchOutputSchema.safeParse({
        query: 'metfromin',
        total_count: 1,
        drugs: [{ ...sampleDrug, tty: 'APPROX' }],
      }).success,
    ).toBe(true);
  });

  it('concept output: with related_groups null when not requested', () => {
    expect(
      RxNormConceptOutputSchema.safeParse({
        rxcui: '6809',
        name: 'metformin',
        synonym: '',
        tty: 'IN',
        language: 'ENG',
        suppress: 'N',
        umlscui: '',
        status: 'Active',
        remapped_to: [],
        related_groups: null,
      }).success,
    ).toBe(true);
  });

  it('concept output: with related_groups populated', () => {
    expect(
      RxNormConceptOutputSchema.safeParse({
        rxcui: '6809',
        name: 'metformin',
        synonym: '',
        tty: 'IN',
        language: 'ENG',
        suppress: 'N',
        umlscui: '',
        status: 'Active',
        remapped_to: [],
        related_groups: [
          {
            tty: 'BN',
            concepts: [
              { rxcui: '152161', name: 'Glucophage', synonym: '', tty: 'BN', language: 'ENG' },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('ingredients output: list with is_multiple flag', () => {
    expect(
      RxNormIngredientsOutputSchema.safeParse({
        rxcui: '152161',
        ingredients: [
          { rxcui: '6809', name: 'metformin', tty: 'IN', is_multiple: false },
        ],
      }).success,
    ).toBe(true);
  });

  it('classes output: list with class_id/class_name/class_type/source', () => {
    expect(
      RxNormClassesOutputSchema.safeParse({
        rxcui: '6809',
        classes: [
          {
            class_id: 'A10BA',
            class_name: 'Biguanides',
            class_type: 'ATC',
            source: 'ATC',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('ndc output: ndcs_for_rxcui mode', () => {
    expect(
      RxNormNDCOutputSchema.safeParse({
        query_mode: 'ndcs_for_rxcui',
        rxcui: '6809',
        ndc: null,
        ndcs: [{ ndc: '00093-0058-01' }, { ndc: '00093-0058-05' }],
      }).success,
    ).toBe(true);
  });

  it('ndc output: rxcui_for_ndc mode, found', () => {
    expect(
      RxNormNDCOutputSchema.safeParse({
        query_mode: 'rxcui_for_ndc',
        rxcui: '6809',
        ndc: '00093-0058-01',
        ndcs: [],
      }).success,
    ).toBe(true);
  });

  it('ndc output: rxcui_for_ndc mode, not found (rxcui null)', () => {
    expect(
      RxNormNDCOutputSchema.safeParse({
        query_mode: 'rxcui_for_ndc',
        rxcui: null,
        ndc: '99999-9999-99',
        ndcs: [],
      }).success,
    ).toBe(true);
  });

  it('ndc output: rejects unknown query_mode', () => {
    expect(
      RxNormNDCOutputSchema.safeParse({
        query_mode: 'unknown',
        rxcui: null,
        ndc: null,
        ndcs: [],
      }).success,
    ).toBe(false);
  });
});

describe('find_equivalent output schema — aggregator with mixed results', () => {
  it('full aggregator: hits in some terminologies, error in another, empty in another', () => {
    expect(
      FindEquivalentOutputSchema.safeParse({
        term: 'diabetes',
        source_terminology: null,
        searched_terminologies: ['icd11', 'snomed', 'loinc', 'rxnorm', 'mesh'],
        results: {
          icd11: {
            found: true,
            error: null,
            items: [{ code: '5A11', title: 'Type 2 diabetes mellitus' }],
          },
          snomed: { found: false, error: 'SNOMED tools are disabled', items: [] },
          loinc: { found: true, error: null, items: [{ code: '2339-0', title: 'Glucose' }] },
          rxnorm: { found: false, error: null, items: [] },
          mesh: { found: true, error: null, items: [{ code: 'D003920', title: 'Diabetes Mellitus' }] },
        },
      }).success,
    ).toBe(true);
  });

  it('source_terminology populated → reflected in output', () => {
    expect(
      FindEquivalentOutputSchema.safeParse({
        term: 'diabetes',
        source_terminology: 'snomed',
        searched_terminologies: ['icd11', 'loinc', 'rxnorm', 'mesh'],
        results: {
          icd11: { found: false, error: null, items: [] },
          loinc: { found: false, error: null, items: [] },
          rxnorm: { found: false, error: null, items: [] },
          mesh: { found: false, error: null, items: [] },
        },
      }).success,
    ).toBe(true);
  });

  it('subset of terminologies searched: results object only contains those keys', () => {
    expect(
      FindEquivalentOutputSchema.safeParse({
        term: 'aspirin',
        source_terminology: null,
        searched_terminologies: ['rxnorm'],
        results: {
          rxnorm: {
            found: true,
            error: null,
            items: [{ code: '1191', title: 'aspirin' }],
          },
        },
      }).success,
    ).toBe(true);
  });

  it('zero-targets edge case: empty searched_terminologies and empty results', () => {
    expect(
      FindEquivalentOutputSchema.safeParse({
        term: 'x',
        source_terminology: 'icd11',
        searched_terminologies: [],
        results: {},
      }).success,
    ).toBe(true);
  });
});

describe('ATC schemas', () => {
  describe('ATC code regex', () => {
    it.each([
      ['A', true],
      ['A10', true],
      ['A10B', true],
      ['A10BA', true],
      ['A10BA02', true],
      // Wrong shape
      ['1', false],
      ['AA', false],
      ['A1', false],
      ['A100', false],
      ['A10BAA', false],
      ['A10BA0', false],
      ['A10BA022', false],
      ['', false],
      // Out-of-range first letter (ATC uses A-V, not W-Z)
      ['Z', false],
    ])('%s → valid=%s', (input, valid) => {
      expect(ATCByCodeParamsSchema.safeParse({ atc_code: input }).success).toBe(valid);
      // Members tool reuses the same code regex
      expect(ATCMembersParamsSchema.safeParse({ atc_code: input }).success).toBe(valid);
    });
  });

  it('classify output round-trips an empty matches array', () => {
    expect(
      ATCClassifyOutputSchema.safeParse({
        drug_name: 'unknown_drug',
        matches: [],
      }).success,
    ).toBe(true);
  });

  it('classify output round-trips a populated match', () => {
    expect(
      ATCClassifyOutputSchema.safeParse({
        drug_name: 'metformin',
        matches: [
          {
            rxcui: '6809',
            drug_name: 'metformin',
            tty: 'IN',
            atc_code: 'A10BA02',
            atc_name: 'metformin',
            atc_level_type: 'ATC1-4',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('lookup output: found=false requires details=null but accepts the shape', () => {
    expect(
      ATCLookupOutputSchema.safeParse({
        atc_code: 'A10BA02',
        found: false,
        details: null,
      }).success,
    ).toBe(true);
  });

  it('members output: empty members allowed', () => {
    expect(
      ATCMembersOutputSchema.safeParse({
        atc_code: 'A10BA',
        members: [],
      }).success,
    ).toBe(true);
  });
});

describe('CID-10 schemas', () => {
  describe('CID-10 code regex', () => {
    it.each([
      ['A00', true],
      ['I21', true],
      ['R092', true],
      ['A00.1', true],
      ['z00', true], // case-insensitive
      // Wrong shape
      ['A0', false],
      ['A0001', false],
      ['AAA', false],
      ['A00.', false],
      ['A00..1', false],
      ['', false],
    ])('%s → valid=%s', (input, valid) => {
      expect(CID10LookupParamsSchema.safeParse({ code: input }).success).toBe(valid);
    });
  });

  describe('chapter param: bounded 1-22', () => {
    it.each([
      [1, true],
      [22, true],
      [11, true],
      [0, false],
      [23, false],
      [-1, false],
      [1.5, false],
    ])('chapter num=%s → valid=%s', (num, valid) => {
      expect(CID10ChapterParamsSchema.safeParse({ num }).success).toBe(valid);
    });
  });

  it('search output: hit shape with chapter_num and group_range nullable', () => {
    expect(
      CID10SearchOutputSchema.safeParse({
        query: 'diabetes',
        level: 'all',
        total_count: 1,
        shown_count: 1,
        hits: [
          {
            level: 'category',
            code: 'E11',
            display: 'E11',
            classif: '',
            title: 'Diabetes mellitus não-insulino-dependente',
            title_short: 'Diabetes mellitus NID',
            refer: '',
            excluidos: '',
            restr_sexo: '',
            causa_obito: '',
            chapter_num: 4,
            group_range: 'E10-E14',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('search output: hit with null chapter_num/group_range allowed', () => {
    expect(
      CID10SearchOutputSchema.safeParse({
        query: 'x',
        level: 'all',
        total_count: 0,
        shown_count: 0,
        hits: [],
      }).success,
    ).toBe(true);

    expect(
      CID10SearchOutputSchema.safeParse({
        query: 'x',
        level: 'all',
        total_count: 1,
        shown_count: 1,
        hits: [
          {
            level: 'subcategory',
            code: 'A001',
            display: 'A00.1',
            classif: '',
            title: 'foo',
            title_short: 'foo',
            refer: '',
            excluidos: '',
            restr_sexo: '',
            causa_obito: '',
            chapter_num: null,
            group_range: null,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('chapters output: empty allowed (degenerate dataset)', () => {
    expect(CID10ChaptersOutputSchema.safeParse({ chapters: [] }).success).toBe(true);
  });

  it('lookup output: not-found shape is found=false + hit=null', () => {
    expect(
      CID10LookupOutputSchema.safeParse({
        code: 'Z99',
        found: false,
        hit: null,
      }).success,
    ).toBe(true);
  });

  it('lookup output: found subcategory shape', () => {
    expect(
      CID10LookupOutputSchema.safeParse({
        code: 'A001',
        found: true,
        hit: {
          level: 'subcategory',
          code: 'A001',
          display: 'A00.1',
          classif: '',
          title: 'Cólera devida a Vibrio cholerae 01, biótipo El Tor',
          title_short: 'Colera...',
          refer: '',
          excluidos: '',
          restr_sexo: '',
          causa_obito: '',
          chapter_num: 1,
          group_range: 'A00-A09',
        },
      }).success,
    ).toBe(true);
  });

  it('chapter detail output: not-found shape is found=false + chapter=null', () => {
    expect(
      CID10ChapterDetailOutputSchema.safeParse({
        num: 5,
        found: false,
        chapter: null,
        groups: [],
      }).success,
    ).toBe(true);
  });

  it('chapter detail output: in-range chapter found shape', () => {
    expect(
      CID10ChapterDetailOutputSchema.safeParse({
        num: 9,
        found: true,
        chapter: {
          num: 9,
          code_start: 'I00',
          code_end: 'I99',
          title: 'Doenças do aparelho circulatório',
          title_short: 'Doenças aparelho circulatório',
        },
        groups: [
          {
            code_start: 'I00',
            code_end: 'I02',
            title: 'Febre reumática aguda',
            title_short: 'Febre reumática aguda',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
