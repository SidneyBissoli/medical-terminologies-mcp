import { z } from 'zod';

// ============================================================================
// Common Types
// ============================================================================

/**
 * Supported languages for terminology queries
 */
export const SupportedLanguageSchema = z.enum(['en', 'es', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ar', 'ru']);
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

/**
 * Direction for hierarchy traversal
 */
export const HierarchyDirectionSchema = z.enum(['parents', 'children']);
export type HierarchyDirection = z.infer<typeof HierarchyDirectionSchema>;

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Pagination options
 */
export const PaginationSchema = z.object({
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).max(100).optional().default(25),
});
export type Pagination = z.infer<typeof PaginationSchema>;

// ============================================================================
// ICD-11 Types
// ============================================================================

/**
 * ICD-11 search parameters
 */
export const ICD11SearchParamsSchema = z.object({
  query: z.string().min(1).describe('Search query text'),
  language: SupportedLanguageSchema.optional().default('en').describe('Language code (default: en)'),
  maxResults: z.number().int().min(1).max(100).optional().default(25).describe('Maximum results to return'),
});
export type ICD11SearchParams = z.infer<typeof ICD11SearchParamsSchema>;

/**
 * ICD-11 lookup parameters
 */
export const ICD11LookupParamsSchema = z.object({
  code: z.string().optional().describe('ICD-11 code (e.g., "BA00")'),
  uri: z.string().url().optional().describe('Full ICD-11 entity URI'),
  language: SupportedLanguageSchema.optional().default('en').describe('Language code'),
}).refine(data => data.code || data.uri, {
  message: 'Either code or uri must be provided',
});
export type ICD11LookupParams = z.infer<typeof ICD11LookupParamsSchema>;

/**
 * ICD-11 hierarchy parameters
 */
export const ICD11HierarchyParamsSchema = z.object({
  code: z.string().min(1).describe('ICD-11 code'),
  direction: HierarchyDirectionSchema.describe('Direction: parents or children'),
});
export type ICD11HierarchyParams = z.infer<typeof ICD11HierarchyParamsSchema>;

/**
 * ICD-11 chapters parameters
 */
export const ICD11ChaptersParamsSchema = z.object({
  language: SupportedLanguageSchema.optional().default('en').describe('Language code'),
});
export type ICD11ChaptersParams = z.infer<typeof ICD11ChaptersParamsSchema>;

/**
 * ICD-11 entity from API response
 */
export interface ICD11Entity {
  id: string;
  code?: string;
  title: string;
  definition?: string;
  longDefinition?: string;
  fullySpecifiedName?: string;
  diagnosticCriteria?: string;
  codingNote?: string;
  blockId?: string;
  codeRange?: string;
  classKind?: string;
  isResidual?: boolean;
  postcoordinationScale?: unknown[];
  parent?: string[];
  child?: string[];
  ancestor?: string[];
  descendant?: string[];
  browserUrl?: string;
}

/**
 * ICD-11 search result item
 */
export interface ICD11SearchResult {
  id: string;
  code?: string;
  title: string;
  score?: number;
  matchingPVs?: string[];
  isLeaf?: boolean;
  postcoordinationAvailability?: string;
  hasCodingNote?: boolean;
  hasMaternalChapterLink?: boolean;
  hasPerinatalChapterLink?: boolean;
  propertiesTruncated?: boolean;
}

// ============================================================================
// LOINC Types
// ============================================================================

/**
 * LOINC search parameters
 */
export const LOINCSearchParamsSchema = z.object({
  query: z.string().min(1).describe('Search term or LOINC code'),
  maxResults: z.number().int().min(1).max(100).optional().default(25).describe('Maximum results'),
});
export type LOINCSearchParams = z.infer<typeof LOINCSearchParamsSchema>;

/**
 * LOINC details parameters
 */
export const LOINCDetailsParamsSchema = z.object({
  loincNum: z.string().regex(/^\d{1,5}-\d$/, 'Invalid LOINC number format').describe('LOINC number (e.g., "2339-0")'),
});
export type LOINCDetailsParams = z.infer<typeof LOINCDetailsParamsSchema>;

/**
 * LOINC item from API response
 */
export interface LOINCItem {
  LOINC_NUM: string;
  COMPONENT: string;
  PROPERTY: string;
  TIME_ASPCT: string;
  SYSTEM: string;
  SCALE_TYP: string;
  METHOD_TYP?: string;
  CLASS: string;
  STATUS: string;
  SHORTNAME?: string;
  LONG_COMMON_NAME: string;
  EXAMPLE_UNITS?: string;
  EXAMPLE_UCUM_UNITS?: string;
  ORDER_OBS?: string;
  HL7_FIELD_SUBFIELD_ID?: string;
}

// ============================================================================
// RxNorm Types
// ============================================================================

/**
 * RxNorm search parameters
 */
export const RxNormSearchParamsSchema = z.object({
  name: z.string().min(1).describe('Drug name to search'),
  maxResults: z.number().int().min(1).max(100).optional().default(25).describe('Maximum results'),
});
export type RxNormSearchParams = z.infer<typeof RxNormSearchParamsSchema>;

/**
 * RxNorm concept parameters
 */
export const RxNormConceptParamsSchema = z.object({
  rxcui: z.string().regex(/^\d+$/, 'RxCUI must be numeric').describe('RxNorm Concept Unique Identifier'),
});
export type RxNormConceptParams = z.infer<typeof RxNormConceptParamsSchema>;

/**
 * RxNorm class parameters
 */
export const RxNormClassParamsSchema = z.object({
  rxcui: z.string().regex(/^\d+$/, 'RxCUI must be numeric').describe('RxNorm Concept Unique Identifier'),
  classType: z.enum(['ATC', 'VA', 'MESH', 'FDASPL', 'FMTSME', 'EPC', 'DISEASE']).optional()
    .describe('Class type filter'),
});
export type RxNormClassParams = z.infer<typeof RxNormClassParamsSchema>;

/**
 * RxNorm concept from API response
 */
export interface RxNormConcept {
  rxcui: string;
  name: string;
  synonym?: string;
  tty: string;
  language?: string;
  suppress?: string;
  umlscui?: string;
}

/**
 * RxNorm drug class
 */
export interface RxNormClass {
  classId: string;
  className: string;
  classType: string;
}

// ============================================================================
// MeSH Types
// ============================================================================

/**
 * MeSH search parameters
 */
export const MeSHSearchParamsSchema = z.object({
  term: z.string().min(1).describe('Search term'),
  maxResults: z.number().int().min(1).max(100).optional().default(25).describe('Maximum results'),
});
export type MeSHSearchParams = z.infer<typeof MeSHSearchParamsSchema>;

/**
 * MeSH descriptor parameters
 */
export const MeSHDescriptorParamsSchema = z.object({
  descriptorId: z.string().regex(/^D\d+$/, 'Invalid MeSH descriptor ID format (must be D followed by numbers)')
    .describe('MeSH descriptor ID (e.g., "D003920")'),
});
export type MeSHDescriptorParams = z.infer<typeof MeSHDescriptorParamsSchema>;

/**
 * MeSH descriptor from API response
 */
export interface MeSHDescriptor {
  descriptorUI: string;
  descriptorName: string;
  scopeNote?: string;
  treeNumbers: string[];
  concepts: MeSHConcept[];
  qualifiers?: MeSHQualifier[];
}

/**
 * MeSH concept within a descriptor
 */
export interface MeSHConcept {
  conceptUI: string;
  conceptName: string;
  isPreferred: boolean;
  terms: MeSHTerm[];
}

/**
 * MeSH term within a concept
 */
export interface MeSHTerm {
  termUI: string;
  termName: string;
  isPreferred: boolean;
}

/**
 * MeSH qualifier
 */
export interface MeSHQualifier {
  qualifierUI: string;
  qualifierName: string;
}

// ============================================================================
// SNOMED CT Types
// ============================================================================

/**
 * SNOMED search parameters
 */
export const SNOMEDSearchParamsSchema = z.object({
  term: z.string().min(1).describe('Search term'),
  semanticTag: z.string().optional().describe('Semantic tag filter (e.g., "disorder", "procedure")'),
  activeOnly: z.boolean().optional().default(true).describe('Only return active concepts'),
});
export type SNOMEDSearchParams = z.infer<typeof SNOMEDSearchParamsSchema>;

/**
 * SNOMED concept parameters
 */
export const SNOMEDConceptParamsSchema = z.object({
  sctid: z.string().regex(/^\d+$/, 'SCTID must be numeric').describe('SNOMED CT Concept Identifier'),
});
export type SNOMEDConceptParams = z.infer<typeof SNOMEDConceptParamsSchema>;

/**
 * SNOMED hierarchy parameters
 */
export const SNOMEDHierarchyParamsSchema = z.object({
  sctid: z.string().regex(/^\d+$/, 'SCTID must be numeric').describe('SNOMED CT Concept Identifier'),
  direction: HierarchyDirectionSchema.describe('Direction: parents or children'),
});
export type SNOMEDHierarchyParams = z.infer<typeof SNOMEDHierarchyParamsSchema>;

/**
 * SNOMED ECL query parameters
 */
export const SNOMEDECLParamsSchema = z.object({
  eclQuery: z.string().min(1).describe('Expression Constraint Language query'),
});
export type SNOMEDECLParams = z.infer<typeof SNOMEDECLParamsSchema>;

/**
 * SNOMED concept from API response
 */
export interface SNOMEDConcept {
  conceptId: string;
  active: boolean;
  moduleId: string;
  definitionStatus: string;
  fsn: {
    term: string;
    lang: string;
  };
  pt: {
    term: string;
    lang: string;
  };
  descriptions?: SNOMEDDescription[];
}

/**
 * SNOMED description
 */
export interface SNOMEDDescription {
  descriptionId: string;
  term: string;
  type: string;
  lang: string;
  caseSignificance: string;
  active: boolean;
  acceptability?: Record<string, string>;
}

// ============================================================================
// Crosswalk Types
// ============================================================================

/**
 * ICD-10 to ICD-11 mapping parameters
 */
export const MapICD10ToICD11ParamsSchema = z.object({
  icd10Code: z.string().min(1).describe('ICD-10 code to map'),
});
export type MapICD10ToICD11Params = z.infer<typeof MapICD10ToICD11ParamsSchema>;

/**
 * SNOMED to ICD-10 mapping parameters
 */
export const MapSNOMEDToICD10ParamsSchema = z.object({
  sctid: z.string().regex(/^\d+$/, 'SCTID must be numeric').describe('SNOMED CT Concept Identifier'),
});
export type MapSNOMEDToICD10Params = z.infer<typeof MapSNOMEDToICD10ParamsSchema>;

/**
 * LOINC to SNOMED mapping parameters
 */
export const MapLOINCToSNOMEDParamsSchema = z.object({
  loincNum: z.string().regex(/^\d{1,5}-\d$/, 'Invalid LOINC number format').describe('LOINC number'),
});
export type MapLOINCToSNOMEDParams = z.infer<typeof MapLOINCToSNOMEDParamsSchema>;

/**
 * Source systems for crosswalk
 */
export const SourceSystemSchema = z.enum(['ICD10', 'ICD11', 'SNOMED', 'LOINC', 'RXNORM', 'MESH']);
export type SourceSystem = z.infer<typeof SourceSystemSchema>;

/**
 * Find equivalent parameters
 */
export const FindEquivalentParamsSchema = z.object({
  code: z.string().min(1).describe('Source code'),
  sourceSystem: SourceSystemSchema.describe('Source terminology system'),
});
export type FindEquivalentParams = z.infer<typeof FindEquivalentParamsSchema>;

/**
 * Mapping result
 */
export interface MappingResult {
  sourceCode: string;
  sourceSystem: string;
  targetCode: string;
  targetSystem: string;
  targetTitle?: string;
  mapType: 'equivalent' | 'broader' | 'narrower' | 'related' | 'noMap';
  mapAdvice?: string;
  confidence?: number;
}

// ============================================================================
// OAuth Types
// ============================================================================

/**
 * OAuth2 token response
 */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Cached OAuth token with expiry
 */
export interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Custom error for API failures
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Custom error for validation failures
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
