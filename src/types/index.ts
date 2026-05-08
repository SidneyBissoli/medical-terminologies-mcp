import { z } from 'zod';

// ============================================================================
// Shared building blocks
// ============================================================================

const SupportedLanguageSchema = z
  .enum(['en', 'es', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ar', 'ru'])
  .describe('Language code (default: en)');

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
// MeSH params
// ============================================================================

export const MeSHSearchParamsSchema = z.object({
  query: z.string().min(1).describe('Search term (e.g., "diabetes", "heart failure")'),
  match: z
    .enum(['exact', 'contains', 'startswith'])
    .optional()
    .default('contains')
    .describe('Match type: exact, contains, or startswith. Default: contains'),
  max_results: maxResults(25),
});

/** Shared shape for mesh_descriptor / mesh_tree / mesh_qualifiers */
export const MeSHByIdParamsSchema = z.object({
  mesh_id: MeSHIdSchema.describe('MeSH Descriptor ID (e.g., D015242, D003920)'),
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
  max_results: maxResults(25),
});

/** Shared shape for snomed_concept / snomed_descriptions */
export const SNOMEDBySctidParamsSchema = z.object({
  sctid: SCTIDSchema.describe('SNOMED CT Identifier (e.g., 73211009)'),
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
});

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
