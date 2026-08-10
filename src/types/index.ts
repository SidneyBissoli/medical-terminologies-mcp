import { z } from 'zod';

// ============================================================================
// Shared building blocks
// ============================================================================

const SupportedLanguageSchema = z
  .enum(['en', 'es', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ar', 'ru'])
  .describe(
    "Language code (default: en). Returns the source's OFFICIAL translation when it exists (e.g. 'pt' for official Portuguese); content is never machine-translated.",
  );

const TerminologyEnum = z.enum(['icd11', 'snomed', 'loinc', 'rxnorm', 'mesh']);

const SCTIDSchema = z
  .string()
  .regex(/^\d+$/, 'SCTID must be numeric (digits only)');

const RxCUISchema = z
  .string()
  .regex(/^\d+$/, 'RxCUI must be numeric (digits only)');

const LOINCNumberSchema = z
  .string()
  .regex(/^\d{1,5}-\d$/, 'Invalid LOINC number; expected format like "2339-0"');

const MeSHIdSchema = z
  .string()
  .regex(/^D\d+$/, 'Invalid MeSH descriptor ID; expected "D" followed by digits (e.g., D015242)');

const maxResults = (defaultValue: number) =>
  z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(defaultValue)
    .describe(`Maximum number of results (1-100). Default: ${defaultValue}`);

// ============================================================================
// ICD-11 params
// ============================================================================

export const ICD11SearchParamsSchema = z.object({
  query: z.string().min(1).describe('Search text (disease name, symptom, or keyword)'),
  language: SupportedLanguageSchema.optional().default('en'),
  max_results: maxResults(25),
});

export const ICD11LookupParamsSchema = z
  .object({
    code: z.string().min(1).optional().describe('ICD-11 code (e.g., "BA00", "1A00")'),
    uri: z.string().url().optional().describe('Full ICD-11 foundation URI'),
    language: SupportedLanguageSchema.optional().default('en'),
  })
  .refine((data) => Boolean(data.code) || Boolean(data.uri), {
    message: 'Either "code" or "uri" must be provided',
  });

export const ICD11HierarchyParamsSchema = z.object({
  code: z.string().min(1).describe('ICD-11 code to get hierarchy for'),
  direction: z
    .enum(['parents', 'children'])
    .describe('Direction: "parents" for ancestors, "children" for subtypes'),
});

export const ICD11ChaptersParamsSchema = z.object({
  language: SupportedLanguageSchema.optional().default('en'),
});

export const ICD11PostcoordinationParamsSchema = z.object({
  code: z.string().min(1).describe('ICD-11 code to get postcoordination info for'),
});

// ============================================================================
// ICD-11 output schemas (structuredContent)
// ============================================================================

const ICD11MatchingPVSchema = z.object({
  property_id: z.string(),
  label: z.string(),
  score: z.number(),
  important: z.boolean().optional(),
});

export const ICD11SearchOutputSchema = z.object({
  query: z.string(),
  total_count: z.number().int(),
  entities: z.array(
    z.object({
      code: z.string().nullable(),
      title: z.string(),
      score: z.number(),
      uri: z.string(),
      is_leaf: z.boolean(),
      matching_pvs: z.array(ICD11MatchingPVSchema),
    }),
  ),
});

const ICD11LabelRefSchema = z.object({
  uri: z.string(),
  label: z.string(),
});

export const ICD11LookupOutputSchema = z.object({
  code: z.string().nullable(),
  code_range: z.string().nullable(),
  uri: z.string(),
  title: z.string(),
  class_kind: z.string().nullable(),
  block_id: z.string().nullable(),
  definition: z.string().nullable(),
  long_definition: z.string().nullable(),
  diagnostic_criteria: z.string().nullable(),
  coding_note: z.string().nullable(),
  exclusions: z.array(ICD11LabelRefSchema),
  inclusions: z.array(ICD11LabelRefSchema),
  index_terms: z.array(ICD11LabelRefSchema),
  browser_url: z.string().nullable(),
});

export const ICD11HierarchyOutputSchema = z.object({
  code: z.string(),
  direction: z.enum(['parents', 'children']),
  entities: z.array(
    z.object({
      code: z.string().nullable(),
      code_range: z.string().nullable(),
      title: z.string(),
      uri: z.string(),
    }),
  ),
});

export const ICD11ChaptersOutputSchema = z.object({
  chapters: z.array(
    z.object({
      number: z.number().int(),
      uri: z.string(),
      code: z.string().nullable(),
      code_range: z.string().nullable(),
      title: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});

export const ICD11PostcoordinationOutputSchema = z.object({
  code: z.string(),
  axes: z.array(
    z.object({
      axis_name: z.string(),
      required: z.boolean(),
      allow_multiple: z.boolean(),
      value_count: z.number().int().nullable(),
    }),
  ),
});

export type ICD11SearchOutput = z.infer<typeof ICD11SearchOutputSchema>;
export type ICD11LookupOutput = z.infer<typeof ICD11LookupOutputSchema>;
export type ICD11HierarchyOutput = z.infer<typeof ICD11HierarchyOutputSchema>;
export type ICD11ChaptersOutput = z.infer<typeof ICD11ChaptersOutputSchema>;
export type ICD11PostcoordinationOutput = z.infer<typeof ICD11PostcoordinationOutputSchema>;

// ============================================================================
// LOINC params
// ============================================================================

export const LOINCSearchParamsSchema = z.object({
  query: z.string().min(1).describe('Search term (test name, keyword, or partial LOINC code)'),
  max_results: maxResults(25),
});

/** Shared shape for loinc_details / loinc_answers / loinc_panels */
export const LOINCByCodeParamsSchema = z.object({
  loinc_num: LOINCNumberSchema.describe('LOINC number (e.g., "2339-0")'),
});

// ============================================================================
// LOINC output schemas (structuredContent)
// ============================================================================

const LOINCItemOutputSchema = z.object({
  loinc_num: z.string(),
  long_common_name: z.string(),
  short_name: z.string(),
  component: z.string(),
  property: z.string(),
  time_aspect: z.string(),
  system: z.string(),
  scale_type: z.string(),
  method_type: z.string(),
  class: z.string(),
  status: z.string(),
  // LOINC License §10 pass-through: some LOINC terms carry third-party
  // copyright (e.g. survey instruments like PHQ-9). When Clinical Tables
  // exposes EXTERNAL_COPYRIGHT_NOTICE for a term, it is served verbatim
  // alongside the term; null when the term carries none.
  external_copyright_notice: z.string().nullable(),
});

export const LOINCSearchOutputSchema = z.object({
  query: z.string(),
  total_count: z.number().int(),
  shown_count: z.number().int(),
  items: z.array(LOINCItemOutputSchema),
});

export const LOINCDetailsOutputSchema = LOINCItemOutputSchema;

export const LOINCAnswersOutputSchema = z.object({
  loinc_num: z.string(),
  answers: z.array(
    z.object({
      sequence: z.number().int(),
      answer_code: z.string(),
      answer_string: z.string(),
    }),
  ),
});

const LOINCPanelOutputSchema = z.object({
  loinc_num: z.string(),
  name: z.string(),
  items: z.array(
    z.object({
      sequence: z.number().int(),
      loinc_num: z.string(),
      name: z.string(),
      required: z.boolean(),
    }),
  ),
});

export const LOINCPanelsOutputSchema = z.object({
  loinc_num: z.string(),
  panel: LOINCPanelOutputSchema.nullable(),
});

export type LOINCSearchOutput = z.infer<typeof LOINCSearchOutputSchema>;
export type LOINCDetailsOutput = z.infer<typeof LOINCDetailsOutputSchema>;
export type LOINCAnswersOutput = z.infer<typeof LOINCAnswersOutputSchema>;
export type LOINCPanelsOutput = z.infer<typeof LOINCPanelsOutputSchema>;

// ============================================================================
// RxNorm params
// ============================================================================

export const RxNormSearchParamsSchema = z.object({
  query: z.string().min(1).describe('Drug name to search (brand or generic)'),
  max_results: maxResults(25),
});

export const RxNormConceptParamsSchema = z.object({
  rxcui: RxCUISchema.describe('RxNorm Concept Unique Identifier'),
  include_related: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include related concepts (ingredients, brands, dose forms)'),
});

/** Shared shape for rxnorm_ingredients / rxnorm_classes */
export const RxNormByRxcuiParamsSchema = z.object({
  rxcui: RxCUISchema.describe('RxCUI of the drug'),
});

export const RxNormNDCParamsSchema = z
  .object({
    rxcui: RxCUISchema.optional().describe('RxCUI to get NDC codes for'),
    ndc: z
      .string()
      .min(1)
      .optional()
      .describe('NDC code to look up RxCUI (alternative to rxcui)'),
  })
  .refine((data) => Boolean(data.rxcui) || Boolean(data.ndc), {
    message: 'Either "rxcui" or "ndc" must be provided',
  });

// ============================================================================
// RxNorm output schemas (structuredContent)
// ============================================================================

const RxNormDrugOutputSchema = z.object({
  rxcui: z.string(),
  name: z.string(),
  synonym: z.string(),
  tty: z.string(),
  language: z.string(),
});

export const RxNormSearchOutputSchema = z.object({
  query: z.string(),
  total_count: z.number().int(),
  // tty === 'APPROX' on items signals the search used the approximate-match
  // fallback rather than an exact name match.
  drugs: z.array(RxNormDrugOutputSchema),
});

export const RxNormConceptOutputSchema = z.object({
  rxcui: z.string(),
  name: z.string(),
  synonym: z.string(),
  tty: z.string(),
  language: z.string(),
  suppress: z.string(),
  umlscui: z.string(),
  status: z.string(),
  remapped_to: z.array(z.string()),
  // Populated only when include_related=true; null when the caller didn't
  // ask for related concepts so the field's absence vs emptiness is
  // unambiguous.
  related_groups: z
    .array(
      z.object({
        tty: z.string(),
        concepts: z.array(RxNormDrugOutputSchema),
      }),
    )
    .nullable(),
});

export const RxNormIngredientsOutputSchema = z.object({
  rxcui: z.string(),
  ingredients: z.array(
    z.object({
      rxcui: z.string(),
      name: z.string(),
      tty: z.string(),
      is_multiple: z.boolean(),
    }),
  ),
});

export const RxNormClassesOutputSchema = z.object({
  rxcui: z.string(),
  classes: z.array(
    z.object({
      class_id: z.string(),
      class_name: z.string(),
      class_type: z.string(),
      source: z.string(),
    }),
  ),
});

export const RxNormNDCOutputSchema = z.object({
  // 'ndcs_for_rxcui': rxcui populated, ndc null, ndcs = list.
  // 'rxcui_for_ndc':  ndc populated, rxcui = found ID or null, ndcs = [].
  query_mode: z.enum(['ndcs_for_rxcui', 'rxcui_for_ndc']),
  rxcui: z.string().nullable(),
  ndc: z.string().nullable(),
  ndcs: z.array(z.object({ ndc: z.string() })),
});

export type RxNormSearchOutput = z.infer<typeof RxNormSearchOutputSchema>;
export type RxNormConceptOutput = z.infer<typeof RxNormConceptOutputSchema>;
export type RxNormIngredientsOutput = z.infer<typeof RxNormIngredientsOutputSchema>;
export type RxNormClassesOutput = z.infer<typeof RxNormClassesOutputSchema>;
export type RxNormNDCOutput = z.infer<typeof RxNormNDCOutputSchema>;

// ============================================================================
// MeSH params
// ============================================================================

export const MeSHSearchParamsSchema = z.object({
  query: z.string().min(1).describe('Search term (e.g., "diabetes", "heart failure")'),
  match: z
    .enum(['exact', 'contains', 'startswith'])
    .optional()
    .default('contains')
    .describe('Match type: exact, contains, or startswith. Default: contains'),
  language: SupportedLanguageSchema.optional().default('en'),
  max_results: maxResults(25),
});

/** Shared shape for mesh_tree / mesh_qualifiers — those don't take a language. */
export const MeSHByIdParamsSchema = z.object({
  mesh_id: MeSHIdSchema.describe('MeSH Descriptor ID (e.g., D015242, D003920)'),
});

/** mesh_descriptor takes a language as well (Accept-Language propagated upstream). */
export const MeSHDescriptorParamsSchema = z.object({
  mesh_id: MeSHIdSchema.describe('MeSH Descriptor ID (e.g., D015242, D003920)'),
  language: SupportedLanguageSchema.optional().default('en'),
});

// ============================================================================
// MeSH output schemas (structuredContent)
// ============================================================================

const MeSHTreeNumberOutputSchema = z.object({
  tree_number: z.string(),
  uri: z.string(),
});

const MeSHQualifierOutputSchema = z.object({
  id: z.string(),
  uri: z.string(),
  label: z.string(),
});

export const MeSHSearchOutputSchema = z.object({
  query: z.string(),
  match: z.enum(['exact', 'contains', 'startswith']),
  total_count: z.number().int(),
  descriptors: z.array(
    z.object({
      id: z.string(),
      uri: z.string(),
      label: z.string(),
    }),
  ),
});

export const MeSHDescriptorOutputSchema = z.object({
  id: z.string(),
  uri: z.string(),
  label: z.string(),
  scope_note: z.string(),
  tree_numbers: z.array(MeSHTreeNumberOutputSchema),
  concepts: z.array(
    z.object({
      uri: z.string(),
      label: z.string(),
      is_preferred: z.boolean(),
      terms: z.array(z.string()),
    }),
  ),
  qualifiers: z.array(MeSHQualifierOutputSchema),
});

export const MeSHTreeOutputSchema = z.object({
  mesh_id: z.string(),
  tree_numbers: z.array(MeSHTreeNumberOutputSchema),
});

export const MeSHQualifiersOutputSchema = z.object({
  mesh_id: z.string(),
  qualifiers: z.array(MeSHQualifierOutputSchema),
});

export type MeSHSearchOutput = z.infer<typeof MeSHSearchOutputSchema>;
export type MeSHDescriptorOutput = z.infer<typeof MeSHDescriptorOutputSchema>;
export type MeSHTreeOutput = z.infer<typeof MeSHTreeOutputSchema>;
export type MeSHQualifiersOutput = z.infer<typeof MeSHQualifiersOutputSchema>;

// ============================================================================
// SNOMED CT params
// ============================================================================

export const SNOMEDSearchParamsSchema = z.object({
  query: z.string().min(1).describe('Search term (e.g., "diabetes", "myocardial infarction")'),
  active_only: z
    .boolean()
    .optional()
    .default(true)
    .describe('Only return active concepts. Default: true'),
  language: SupportedLanguageSchema.optional().default('en'),
  max_results: maxResults(25),
});

/** Shared shape for snomed_descriptions (no language — that endpoint returns all). */
export const SNOMEDBySctidParamsSchema = z.object({
  sctid: SCTIDSchema.describe('SNOMED CT Identifier (e.g., 73211009)'),
});

/** snomed_concept takes a language as well (Accept-Language propagated upstream). */
export const SNOMEDConceptParamsSchema = z.object({
  sctid: SCTIDSchema.describe('SNOMED CT Identifier (e.g., 73211009)'),
  language: SupportedLanguageSchema.optional().default('en'),
});

export const SNOMEDHierarchyParamsSchema = z.object({
  sctid: SCTIDSchema.describe('SNOMED CT Identifier'),
  direction: z
    .enum(['parents', 'children', 'both'])
    .optional()
    .default('both')
    .describe('Direction: parents, children, or both. Default: both'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe('Maximum children to return (1-100). Default: 50'),
});

export const SNOMEDECLParamsSchema = z.object({
  ecl: z.string().min(1).describe('ECL expression (e.g., "<< 73211009" for all types of diabetes)'),
  max_results: maxResults(25),
});

// ============================================================================
// SNOMED CT output schemas (structuredContent)
// ============================================================================

const SNOMEDConceptSummarySchema = z.object({
  concept_id: z.string(),
  fsn: z.string(),
  pt: z.string(),
  active: z.boolean(),
  definition_status: z.string(),
  module_id: z.string(),
});

const SNOMEDHierarchyConceptSchema = z.object({
  concept_id: z.string(),
  fsn: z.string(),
  pt: z.string(),
  active: z.boolean(),
  definition_status: z.string(),
});

export const SNOMEDSearchOutputSchema = z.object({
  query: z.string(),
  active_only: z.boolean(),
  total_count: z.number().int(),
  concepts: z.array(SNOMEDConceptSummarySchema),
});

export const SNOMEDConceptOutputSchema = z.object({
  concept_id: z.string(),
  fsn: z.string(),
  pt: z.string(),
  active: z.boolean(),
  effective_time: z.string(),
  definition_status: z.string(),
  module_id: z.string(),
});

export const SNOMEDHierarchyOutputSchema = z.object({
  sctid: z.string(),
  direction: z.enum(['parents', 'children', 'both']),
  parents: z.array(SNOMEDHierarchyConceptSchema),
  children: z.array(SNOMEDHierarchyConceptSchema),
});

export const SNOMEDDescriptionsOutputSchema = z.object({
  sctid: z.string(),
  descriptions: z.array(
    z.object({
      description_id: z.string(),
      term: z.string(),
      type: z.string(),
      type_id: z.string(),
      lang: z.string(),
      active: z.boolean(),
      case_significance: z.string(),
      acceptability_map: z.record(z.string(), z.string()),
    }),
  ),
});

export const SNOMEDECLOutputSchema = z.object({
  ecl: z.string(),
  total_count: z.number().int(),
  concepts: z.array(SNOMEDConceptSummarySchema),
});

export type SNOMEDSearchOutput = z.infer<typeof SNOMEDSearchOutputSchema>;
export type SNOMEDConceptOutput = z.infer<typeof SNOMEDConceptOutputSchema>;
export type SNOMEDHierarchyOutput = z.infer<typeof SNOMEDHierarchyOutputSchema>;
export type SNOMEDDescriptionsOutput = z.infer<typeof SNOMEDDescriptionsOutputSchema>;
export type SNOMEDECLOutput = z.infer<typeof SNOMEDECLOutputSchema>;

// ============================================================================
// Crosswalk params
// ============================================================================

export const MapICD10ToICD11ParamsSchema = z.object({
  icd10_code: z
    .string()
    .min(1)
    .describe('ICD-10 code to query in the ICD-11 search index (e.g., E11, I21.0, J18.9)'),
});

export const MapSNOMEDToICD10ParamsSchema = z.object({
  sctid: SCTIDSchema.describe('SNOMED CT Identifier'),
});

export const MapLOINCToSNOMEDParamsSchema = z.object({
  loinc_code: LOINCNumberSchema.describe('LOINC code (e.g., 2339-0 for Glucose)'),
});

export const FindEquivalentParamsSchema = z.object({
  term: z.string().min(1).describe('Medical term to search (e.g., "diabetes", "aspirin")'),
  source_terminology: TerminologyEnum
    .optional()
    .describe(
      'If set, this terminology is excluded from the search. Use this when the term came from this terminology and you want equivalents in the others. Combines with target_terminologies by subtraction (source is removed from the target list).',
    ),
  target_terminologies: z
    .array(TerminologyEnum)
    .optional()
    .describe('Limit the search to these terminologies. If omitted, all five are searched.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe(
      'Maximum candidates returned PER terminology (1-10, default 5). This is a cap, not a page: the live fan-out has no stable cursor across five upstreams, so raise the limit instead of paging.',
    ),
});

// ============================================================================
// find_equivalent output schema (structuredContent)
//
// Shape note: per-terminology items are normalized to { code, title } so a
// consumer can iterate uniformly across results. The native identifier
// shape (LOINC_NUM vs conceptId vs rxcui vs MeSH ID) is collapsed into the
// generic "code" field. If an LLM/client needs the native shape, it should
// call the per-terminology search tool directly with the relevant code.
// ============================================================================

const FindEquivalentItemSchema = z.object({
  code: z.string(),
  title: z.string(),
  // Native entity URI when the terminology exposes one (ICD-11 foundation
  // URI, MeSH descriptor URI); null otherwise. ICD-11 license invariant:
  // codes and titles are always served with their URIs (§1.2.2–1.2.3).
  uri: z.string().nullable(),
  // D2 ranking (v1.7.0, additive): lexical similarity to the search term,
  // computed by THIS server (upstreams don't expose comparable scores).
  // 0-1, 3 decimals; see src/utils/lexical-score.ts for the formula. The
  // provenance block (next session) will mark these derived: true.
  match_score: z.number().min(0).max(1),
  // Global rank across ALL searched terminologies (1 = best match overall).
  // Ties break by terminology order (icd11, snomed, loinc, rxnorm, mesh),
  // then by upstream result order — deterministic for identical responses.
  rank: z.number().int().min(1),
});

const FindEquivalentTerminologyResultSchema = z.object({
  found: z.boolean(),
  // Populated when the upstream call failed (timeout, server error, or — for
  // SNOMED — when the SNOMED tools are disabled in this server).
  error: z.string().nullable(),
  // Sorted by match_score descending (i.e. by global rank) since v1.7.0;
  // before that the order was whatever the upstream returned.
  items: z.array(FindEquivalentItemSchema),
});

// Cross-terminology grouping (v1.7.0, additive): candidates from DIFFERENT
// terminologies whose normalized titles are lexically identical are grouped
// as likely representations of the same concept. Deliberately conservative:
// exact normalized-title equality only, no fuzzy clustering — a group is a
// strong signal, absence of a group is not evidence of non-equivalence.
const FindEquivalentGroupMemberSchema = z.object({
  terminology: TerminologyEnum,
  code: z.string(),
  title: z.string(),
  match_score: z.number().min(0).max(1),
});

const FindEquivalentGroupSchema = z.object({
  // The shared normalized title (lowercase, diacritics stripped) that
  // members matched on.
  normalized_title: z.string(),
  terminologies: z.array(TerminologyEnum),
  members: z.array(FindEquivalentGroupMemberSchema),
});

export const FindEquivalentOutputSchema = z.object({
  term: z.string(),
  source_terminology: TerminologyEnum.nullable(),
  searched_terminologies: z.array(TerminologyEnum),
  // Each terminology key is present only if it was actually searched (i.e.
  // it's in searched_terminologies). Absent keys mean "not requested",
  // empty items+found:false means "searched, no hits".
  results: z.object({
    icd11: FindEquivalentTerminologyResultSchema.optional(),
    snomed: FindEquivalentTerminologyResultSchema.optional(),
    loinc: FindEquivalentTerminologyResultSchema.optional(),
    rxnorm: FindEquivalentTerminologyResultSchema.optional(),
    mesh: FindEquivalentTerminologyResultSchema.optional(),
  }),
  // Groups of lexically identical candidates across terminologies, sorted
  // by best member match_score. Empty when nothing groups.
  groups: z.array(FindEquivalentGroupSchema),
  // Self-description of the server-side ranking so consumers know the
  // scores are derived here, not upstream relevance.
  ranking: z.object({
    method: z.literal('lexical'),
    note: z.string(),
  }),
});

export type FindEquivalentOutput = z.infer<typeof FindEquivalentOutputSchema>;

// ============================================================================
// Crosswalk outputs
//
// `map_icd10_to_icd11` returns the real WHO transition-table entry (or null
// when the code isn't in the category-level table). The other two are
// guidance-only by design — no authoritative LOINC↔SNOMED or SNOMED→ICD-10
// mapping is freely available via API, so the structured payload exposes the
// LOINC/SNOMED lookup result we *can* do plus pointers to the licensed
// sources operators can use to perform the actual mapping themselves. When
// 13.7 (Snowstorm refset 447562003) ships, `MapSNOMEDToICD10OutputSchema`
// becomes the envelope that wraps the real ReferenceSetMember list.
// ============================================================================

const ICD10SourceSchema = z.object({
  code: z.string(),
  title: z.string(),
  chapter: z.string(),
  depth: z.number().int(),
});

const ICD11MappingSchema = z.object({
  code: z.string(),
  title: z.string(),
  chapter: z.string(),
  foundationUri: z.string(),
  linearizationUri: z.string(),
  classKind: z.string(),
  depth: z.number().int(),
});

export const MapICD10ToICD11OutputSchema = z.object({
  query: z.string().describe('The ICD-10 code as submitted (raw, before normalization).'),
  found: z
    .boolean()
    .describe('Whether the code is in the WHO ICD-10 → ICD-11 transition table.'),
  icd10: ICD10SourceSchema
    .nullable()
    .describe('Source ICD-10 entry from the WHO table. Null when found=false.'),
  primary: ICD11MappingSchema
    .nullable()
    .describe('Primary 1:1 ICD-11 mapping. Null when found=false.'),
  alternatives: z
    .array(ICD11MappingSchema)
    .describe(
      'Additional ICD-11 candidates WHO documents for this ICD-10 code. Empty when the primary is the only documented mapping (or when found=false). 1,461 of the 11,243 indexed codes have non-empty alternatives.',
    ),
  source: z.object({
    publisher: z.string().describe('Authoritative publisher (e.g. "WHO").'),
    version: z
      .string()
      .describe('Transition table release identifier (e.g. "2025-01").'),
    release_date: z.string().describe('ISO date string for the release.'),
  }),
});

export type MapICD10ToICD11Output = z.infer<typeof MapICD10ToICD11OutputSchema>;

const MappingSourceRefSchema = z.object({
  name: z.string(),
  description: z.string(),
  url: z.string().nullable(),
});

export const MapSNOMEDToICD10OutputSchema = z.object({
  sctid: z.string().describe('The SNOMED CT Identifier as submitted.'),
  preferred_term: z
    .string()
    .nullable()
    .describe(
      'SNOMED preferred term for the concept, when the upstream returns one. Null when the SNOMED upstream timed out or returned nothing.',
    ),
  status: z
    .enum(['guidance-only', 'upstream-unavailable'])
    .describe(
      '"guidance-only" — no freely available authoritative SNOMED → ICD-10 mapping API exists today; this tool returns pointers to the licensed sources (UMLS, refset 447562003) instead. "upstream-unavailable" — SNOMED was attempted but the Snowstorm host did not respond.',
    ),
  guidance: z
    .string()
    .describe(
      'Short human-readable explanation of why this tool returns guidance instead of a mapping.',
    ),
  authoritative_sources: z
    .array(MappingSourceRefSchema)
    .describe(
      'Structured list of authoritative SNOMED → ICD-10 mapping sources for programmatic consumers (UMLS Metathesaurus, SNOMED Complex Map refset, national extensions).',
    ),
});

export type MapSNOMEDToICD10Output = z.infer<typeof MapSNOMEDToICD10OutputSchema>;

const LOINCDetailsSchema = z.object({
  code: z.string(),
  long_common_name: z.string().nullable(),
  component: z.string().nullable(),
  system: z.string().nullable(),
  property: z.string().nullable(),
});

export const MapLOINCToSNOMEDOutputSchema = z.object({
  loinc_code: z.string().describe('The LOINC code as submitted.'),
  loinc_details: LOINCDetailsSchema
    .nullable()
    .describe(
      'NLM Clinical Tables details for the LOINC code (component, system, property, etc.). Null when the code was not found upstream.',
    ),
  status: z
    .enum(['guidance-only'])
    .describe(
      'Always "guidance-only" — direct LOINC → SNOMED CT mappings require licensed sources (UMLS Metathesaurus or LOINC SNOMED CT Expression Association). This tool returns pointers, not the mapping itself.',
    ),
  guidance: z
    .string()
    .describe(
      'Short human-readable explanation of why this tool returns guidance instead of a mapping.',
    ),
  mapping_sources: z
    .array(MappingSourceRefSchema)
    .describe(
      'Structured list of authoritative LOINC → SNOMED CT mapping sources (UMLS Metathesaurus, LOINC SNOMED CT Expression Association, Regenstrief RELMA).',
    ),
});

export type MapLOINCToSNOMEDOutput = z.infer<typeof MapLOINCToSNOMEDOutputSchema>;

// ============================================================================
// validate_codes params + output
//
// Covers the wider terminology set including ICD-10, CID-10, and ATC, which
// the original TerminologyEnum (built around find_equivalent's search scope)
// doesn't include. Kept as a separate enum so expanding it here doesn't
// silently broaden find_equivalent's input acceptance.
// ============================================================================

export const ValidateCodesTerminologyEnum = z.enum([
  'icd11',
  'icd10',
  'snomed',
  'loinc',
  'rxnorm',
  'mesh',
  'atc',
  'cid10',
]);

export type ValidateCodesTerminology = z.infer<typeof ValidateCodesTerminologyEnum>;

const ValidateCodesItemSchema = z.object({
  code: z.string().min(1).describe('The code to validate (raw, as it appears in your data).'),
  terminology: ValidateCodesTerminologyEnum.describe(
    'Which terminology this code belongs to. Required — auto-detection isn\'t supported because category-level codes like "A00" exist in both ICD-10 and CID-10.',
  ),
});

export const ValidateCodesParamsSchema = z.object({
  codes: z
    .array(ValidateCodesItemSchema)
    .min(1, 'At least one code is required.')
    .max(50, 'Maximum 50 codes per call (rate limits apply per upstream API).')
    .describe('List of code+terminology pairs to validate. Hard cap of 50 per call to keep total latency under ~10 s given upstream rate limits.'),
});

const ValidateCodesResultSchema = z.object({
  code: z.string().describe('The code as submitted.'),
  terminology: ValidateCodesTerminologyEnum,
  valid: z
    .boolean()
    .describe('True when the upstream API or bundled dataset confirms the code exists.'),
  active: z
    .boolean()
    .nullable()
    .describe(
      'Whether the code is currently active. Null when the source terminology doesn\'t expose an explicit active/inactive distinction at the category level (e.g. CID-10, ATC).',
    ),
  title: z.string().nullable().describe('Official label/title for the code, when available.'),
  replaced_by: z
    .string()
    .nullable()
    .describe(
      'When the code has been superseded by another code, this holds the replacement. Populated today only for ICD-10 codes that have a primary ICD-11 mapping in the bundled WHO transition tables; null otherwise.',
    ),
  source: z
    .string()
    .describe('Human-readable identifier of the data source used for validation (terminology + release/version where applicable).'),
  error: z
    .string()
    .nullable()
    .describe(
      'When the upstream call failed (timeout, server error, feature flag off), this holds the failure message. Distinct from valid=false: valid=false + error=null means "code not found"; valid=false + error set means "couldn\'t validate".',
    ),
});

export const ValidateCodesOutputSchema = z.object({
  total: z.number().int().describe('Number of codes submitted.'),
  valid_count: z.number().int().describe('How many were confirmed valid.'),
  invalid_count: z.number().int().describe('How many were not found.'),
  error_count: z
    .number()
    .int()
    .describe('How many couldn\'t be validated due to upstream/network errors.'),
  results: z.array(ValidateCodesResultSchema),
});

export type ValidateCodesOutput = z.infer<typeof ValidateCodesOutputSchema>;
export type ValidateCodesResult = z.infer<typeof ValidateCodesResultSchema>;

// ============================================================================
// terminology_versions + terminology_diff params + outputs
// ============================================================================

export const TerminologyVersionsParamsSchema = z.object({
  terminology: ValidateCodesTerminologyEnum
    .optional()
    .describe('Filter to a single terminology. Omit to return all 8.'),
});

const TerminologyVersionEntrySchema = z.object({
  code: ValidateCodesTerminologyEnum,
  name: z.string(),
  full_name: z.string(),
  publisher: z.string(),
  current_version: z.string(),
  release_date: z.string(),
  source_url: z.string(),
  changelog_url: z.string().nullable(),
  update_cadence: z.string(),
  bundled_in_server: z.boolean(),
  notes: z.string().nullable(),
});

export const TerminologyVersionsOutputSchema = z.object({
  generated: z.string().describe('Date this snapshot was generated.'),
  total: z.number().int(),
  terminologies: z.array(TerminologyVersionEntrySchema),
});

export type TerminologyVersionsOutput = z.infer<typeof TerminologyVersionsOutputSchema>;

export const TerminologyDiffParamsSchema = z.object({
  terminology: ValidateCodesTerminologyEnum
    .describe('Which terminology to report on.'),
  from_version: z
    .string()
    .optional()
    .describe('Version you have data from. Optional; behavior depends on terminology.'),
  to_version: z
    .string()
    .optional()
    .describe('Version you want to compare to. Optional.'),
});

const CrossRevisionSummarySchema = z.object({
  icd10_categories_total: z.number().int(),
  one_to_one_mappings: z.number().int(),
  one_to_many_splits: z.number().int(),
  avg_alternatives_when_split: z.number(),
});

export const TerminologyDiffOutputSchema = z.object({
  terminology: ValidateCodesTerminologyEnum,
  from_version: z.string().nullable(),
  to_version: z.string().nullable(),
  diff_available: z
    .boolean()
    .describe(
      'True when this server has the data to compute a real diff for the requested terminology. False = guidance-only response.',
    ),
  message: z.string(),
  changelog_url: z.string().nullable(),
  bundled_versions: z.array(z.string()),
  cross_revision_summary: CrossRevisionSummarySchema
    .nullable()
    .describe(
      'Populated only for terminology="icd10" today — the bundled WHO ICD-10 → ICD-11 transition tables let us surface a real structural diff between the two WHO revisions.',
    ),
});

export type TerminologyDiffOutput = z.infer<typeof TerminologyDiffOutputSchema>;

// ============================================================================
// ATC params (Anatomical Therapeutic Chemical, served via NLM RxClass)
// ============================================================================

// ATC has 5 levels: anatomical (1 letter) → therapeutic (3 chars) →
// pharmacological (4 chars) → chemical (5 chars) → substance (7 chars).
// Examples: "A", "A10", "A10B", "A10BA", "A10BA02".
const ATCCodeSchema = z
  .string()
  .regex(
    /^[A-V](\d{2}([A-Z]([A-Z](\d{2})?)?)?)?$/,
    'Invalid ATC code; expected formats: A, A10, A10B, A10BA, or A10BA02',
  );

export const ATCClassifyParamsSchema = z.object({
  drug_name: z
    .string()
    .min(1)
    .describe('Drug name to classify (brand or generic, e.g., "metformin")'),
});

export const ATCByCodeParamsSchema = z.object({
  atc_code: ATCCodeSchema.describe(
    'ATC code at level 1-4 (1-5 chars). Substance-level codes (7 chars, e.g., A10BA02) are not exposed by this endpoint — use atc_classify with the drug name instead.',
  ),
});

export const ATCMembersParamsSchema = z.object({
  atc_code: ATCCodeSchema.describe(
    'ATC code at any level. Higher levels (1-4) return all member substances; level 5 returns the single substance.',
  ),
});

// ============================================================================
// ATC output schemas (structuredContent)
// ============================================================================

const ATCClassEntrySchema = z.object({
  atc_code: z.string(),
  atc_name: z.string(),
  atc_level_type: z.string(),
});

export const ATCClassifyOutputSchema = z.object({
  drug_name: z.string(),
  matches: z.array(
    z.object({
      rxcui: z.string(),
      drug_name: z.string(),
      tty: z.string(),
      atc_code: z.string(),
      atc_name: z.string(),
      atc_level_type: z.string(),
    }),
  ),
});

export const ATCLookupOutputSchema = z.object({
  atc_code: z.string(),
  found: z.boolean(),
  // Populated when found=true. Null when the code is unknown or
  // substance-level (RxClass byId doesn't expose the 7-char codes).
  details: ATCClassEntrySchema.nullable(),
});

export const ATCMembersOutputSchema = z.object({
  atc_code: z.string(),
  members: z.array(
    z.object({
      rxcui: z.string(),
      name: z.string(),
      tty: z.string(),
      // The substance-level (7-char) ATC code RxClass attaches per drug.
      // When the queried class is at level 5, this matches atc_code.
      source_atc_code: z.string(),
    }),
  ),
});

export type ATCClassifyOutput = z.infer<typeof ATCClassifyOutputSchema>;
export type ATCLookupOutput = z.infer<typeof ATCLookupOutputSchema>;
export type ATCMembersOutput = z.infer<typeof ATCMembersOutputSchema>;

// ============================================================================
// CID-10 params (Brazilian translation of ICD-10, DataSUS V2008)
// ============================================================================

// CID-10 codes use two display conventions:
//   - 3-char categories: A00, B99, R09
//   - 4-char subcategories: A001, A009, R092 (no dot, as stored in DataSUS CSV)
//   - With dot for display: A00.1, A00.9, R09.2
// We accept both 4-char (A001) and dotted (A00.1) forms in inputs.
const CID10CodeSchema = z
  .string()
  .regex(
    /^[A-Z]\d{2}(\.?\d)?$/i,
    'Invalid CID-10 code; expected formats: A00, A001, or A00.1',
  );

export const CID10SearchParamsSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe('Search term in Portuguese (e.g., "diabetes", "infarto", "tuberculose")'),
  level: z
    .enum(['categories', 'subcategories', 'all'])
    .optional()
    .default('all')
    .describe(
      'Restrict search to 3-char categories, 4-char subcategories, or both. Default: all',
    ),
  max_results: maxResults(25),
});

export const CID10LookupParamsSchema = z.object({
  code: CID10CodeSchema.describe(
    'CID-10 code (e.g., "A00", "A00.1", "A001", "I21"). Dotted and undotted forms both accepted.',
  ),
});

// ============================================================================
// CID-10 output schemas (structuredContent)
// ============================================================================

const CID10ChapterEntrySchema = z.object({
  num: z.number().int(),
  code_start: z.string(),
  code_end: z.string(),
  title: z.string(),
  title_short: z.string(),
});

const CID10GroupEntrySchema = z.object({
  code_start: z.string(),
  code_end: z.string(),
  title: z.string(),
  title_short: z.string(),
});

// Categories (3-char) and subcategories (4-char) share these fields.
// Subcategories add `display` (dotted form) and gender/cause-of-death
// restriction flags.
const CID10HitSchema = z.object({
  level: z.enum(['category', 'subcategory']),
  code: z.string(),
  // Dotted display form. For 3-char categories this equals `code`; for
  // 4-char subcategories it's like "A00.1".
  display: z.string(),
  classif: z.string(),
  title: z.string(),
  title_short: z.string(),
  refer: z.string(),
  excluidos: z.string(),
  // Only meaningful for subcategories. Categories return empty strings.
  restr_sexo: z.string(),
  causa_obito: z.string(),
  // Chapter and group containing this code. Useful for hierarchical
  // navigation without an extra lookup.
  chapter_num: z.number().int().nullable(),
  group_range: z.string().nullable(),
});

export const CID10SearchOutputSchema = z.object({
  query: z.string(),
  level: z.enum(['categories', 'subcategories', 'all']),
  total_count: z.number().int(),
  shown_count: z.number().int(),
  hits: z.array(CID10HitSchema),
});

export const CID10LookupOutputSchema = z.object({
  code: z.string(),
  found: z.boolean(),
  // Populated when found=true; null otherwise.
  hit: CID10HitSchema.nullable(),
});

export const CID10ChaptersOutputSchema = z.object({
  chapters: z.array(CID10ChapterEntrySchema),
});

export const CID10ChapterDetailOutputSchema = z.object({
  num: z.number().int(),
  found: z.boolean(),
  chapter: CID10ChapterEntrySchema.nullable(),
  groups: z.array(CID10GroupEntrySchema),
});

export const CID10ChapterParamsSchema = z.object({
  num: z
    .number()
    .int()
    .min(1)
    .max(22)
    .describe('Chapter number (1-22). CID-10 V2008 has 22 chapters.'),
});

export type CID10SearchOutput = z.infer<typeof CID10SearchOutputSchema>;
export type CID10LookupOutput = z.infer<typeof CID10LookupOutputSchema>;
export type CID10ChaptersOutput = z.infer<typeof CID10ChaptersOutputSchema>;
export type CID10ChapterDetailOutput = z.infer<typeof CID10ChapterDetailOutputSchema>;

// ============================================================================
// Runtime types used by clients (kept here because who-client and the OAuth
// flow consume them)
// ============================================================================

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// ============================================================================
// Errors
// ============================================================================

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
