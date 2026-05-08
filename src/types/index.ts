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
