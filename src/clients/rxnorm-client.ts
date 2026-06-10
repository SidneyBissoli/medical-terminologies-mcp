/**
 * RxNorm API Client
 *
 * Provides access to RxNorm (Normalized names for clinical drugs)
 * through the NIH RxNav REST API.
 *
 * @see https://rxnav.nlm.nih.gov/RxNormAPIs.html
 * @author Sidney Bissoli
 * @license MIT
 */

import { HttpClient, HttpError } from '../utils/http.js';
import { cache, CACHE_PREFIX, DEFAULT_TTL } from '../utils/cache.js';
import { withRetry } from '../utils/retry.js';
import { rateLimiters } from '../utils/rate-limiter.js';
import { ApiError } from '../types/index.js';
import { extractErrorMessage } from '../utils/extract-error-message.js';

/**
 * RxNorm API Configuration
 */
const RXNORM_CONFIG = {
  /** Base URL for RxNorm REST API */
  baseUrl: 'https://rxnav.nlm.nih.gov/REST',
} as const;

/**
 * RxNorm API Client
 *
 * Handles:
 * - Rate limiting (20 requests/second)
 * - Retry with exponential backoff
 * - Response caching
 */
export class RxNormClient {
  private httpClient: HttpClient;

  constructor() {
    this.httpClient = new HttpClient({
      baseURL: RXNORM_CONFIG.baseUrl,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Makes a request to the RxNorm API
   *
   * @param path - API path (without base URL)
   * @param params - Query parameters
   * @returns API response data
   * @throws ApiError on request failure
   */
  async request<T>(
    path: string,
    params: Record<string, string | number | boolean> = {}
  ): Promise<T> {
    // Apply rate limiting
    await rateLimiters.rxnorm.acquire();

    return withRetry(
      async () => {
        try {
          const response = await this.httpClient.get<T>(path, { params });
          return response.data;
        } catch (error) {
          if (error instanceof HttpError) {
            const status = error.status;
            const message = extractErrorMessage(error);

            if (status === 404) {
              throw new ApiError(`Resource not found`, 'NOT_FOUND', status);
            }
            if (status === 429) {
              throw new ApiError('Rate limit exceeded', 'RATE_LIMIT', status);
            }

            throw new ApiError(
              `RxNorm API error: ${message}`,
              'API_ERROR',
              status,
              error.data
            );
          }
          throw error;
        }
      },
      {
        maxRetries: 2,
        retryableStatusCodes: [408, 429, 500, 502, 503, 504],
      }
    );
  }

  // ===========================================================================
  // RxNorm Methods
  // ===========================================================================

  /**
   * Searches for drugs by name
   *
   * @param name - Drug name to search
   * @returns Array of drug concepts
   */
  async searchDrugs(name: string): Promise<RxNormDrugSearchResult> {
    const cacheKey = `rxnorm:search:${name}`;

    return cache.getOrSet(
      CACHE_PREFIX.RXNORM,
      cacheKey,
      async () => {
        const response = await this.request<RxNormDrugsResponse>('/drugs.json', {
          name,
        });

        if (!response.drugGroup?.conceptGroup) {
          return { drugs: [] };
        }

        const drugs: RxNormDrug[] = [];
        for (const group of response.drugGroup.conceptGroup) {
          if (group.conceptProperties) {
            for (const prop of group.conceptProperties) {
              drugs.push({
                rxcui: prop.rxcui,
                name: prop.name,
                synonym: prop.synonym || '',
                tty: prop.tty,
                language: prop.language || 'ENG',
              });
            }
          }
        }

        return { drugs };
      },
      DEFAULT_TTL.SEARCH
    );
  }

  /**
   * Gets approximate matches for a drug name
   *
   * @param term - Search term
   * @param maxResults - Maximum results (default: 25)
   * @returns Array of approximate matches
   */
  async getApproximateMatch(term: string, maxResults: number = 25): Promise<RxNormApproximateMatch[]> {
    const cacheKey = `rxnorm:approx:${term}:${maxResults}`;

    return cache.getOrSet(
      CACHE_PREFIX.RXNORM,
      cacheKey,
      async () => {
        const response = await this.request<RxNormApproxResponse>('/approximateTerm.json', {
          term,
          maxEntries: maxResults,
        });

        if (!response.approximateGroup?.candidate) {
          return [];
        }

        return response.approximateGroup.candidate.map(c => ({
          rxcui: c.rxcui,
          rxaui: c.rxaui || '',
          name: c.name || '',
          score: parseInt(c.score) || 0,
          rank: parseInt(c.rank) || 0,
        }));
      },
      DEFAULT_TTL.SEARCH
    );
  }

  /**
   * Gets concept details by RxCUI
   *
   * @param rxcui - RxNorm Concept Unique Identifier
   * @returns Concept details or null if not found
   */
  async getConcept(rxcui: string): Promise<RxNormConcept | null> {
    const cacheKey = `rxnorm:concept:${rxcui}`;

    return cache.getOrSet(
      CACHE_PREFIX.RXNORM,
      cacheKey,
      async () => {
        try {
          // First get properties (required)
          const propsResponse = await this.request<RxNormPropertiesResponse>(`/rxcui/${rxcui}/properties.json`);

          const props = propsResponse.properties;
          if (!props) {
            return null;
          }

          // Try to get status (optional - don't fail if this errors)
          let status: { status: string; remappedTo?: string[] } | undefined;
          try {
            const statusResponse = await this.request<RxNormStatusResponse>(`/rxcui/${rxcui}/status.json`);
            status = statusResponse.rxcuiStatus;
          } catch {
            // Status endpoint failed, continue without it
          }

          return {
            rxcui: props.rxcui,
            name: props.name,
            synonym: props.synonym || '',
            tty: props.tty,
            language: props.language || 'ENG',
            suppress: props.suppress || 'N',
            umlscui: props.umlscui || '',
            status: status?.status || 'Active',
            remappedTo: status?.remappedTo || [],
          };
        } catch (error) {
          if (error instanceof ApiError && error.code === 'NOT_FOUND') {
            return null;
          }
          throw error;
        }
      },
      DEFAULT_TTL.LOOKUP
    );
  }

  /**
   * Gets all related concepts for an RxCUI
   *
   * @param rxcui - RxNorm Concept Unique Identifier
   * @returns Related concepts grouped by relationship type
   */
  async getRelatedConcepts(rxcui: string): Promise<RxNormRelatedGroup[]> {
    const cacheKey = `rxnorm:related:${rxcui}`;

    return cache.getOrSet(
      CACHE_PREFIX.RXNORM,
      cacheKey,
      async () => {
        const response = await this.request<RxNormAllRelatedResponse>(`/rxcui/${rxcui}/allrelated.json`);

        if (!response.allRelatedGroup?.conceptGroup) {
          return [];
        }

        return response.allRelatedGroup.conceptGroup
          .filter(g => g.conceptProperties && g.conceptProperties.length > 0)
          .map(g => ({
            tty: g.tty,
            concepts: g.conceptProperties!.map(p => ({
              rxcui: p.rxcui,
              name: p.name,
              synonym: p.synonym || '',
              tty: p.tty,
              language: p.language || 'ENG',
            })),
          }));
      },
      DEFAULT_TTL.LOOKUP
    );
  }

  /**
   * Gets active ingredients for a drug
   *
   * @param rxcui - RxNorm Concept Unique Identifier
   * @returns Array of ingredient concepts
   */
  async getIngredients(rxcui: string): Promise<RxNormIngredient[]> {
    const cacheKey = `rxnorm:ingredients:${rxcui}`;

    return cache.getOrSet(
      CACHE_PREFIX.RXNORM,
      cacheKey,
      async () => {
        const response = await this.request<RxNormRelatedResponse>(`/rxcui/${rxcui}/related.json`, {
          tty: 'IN+MIN',
        });

        if (!response.relatedGroup?.conceptGroup) {
          return [];
        }

        const ingredients: RxNormIngredient[] = [];
        for (const group of response.relatedGroup.conceptGroup) {
          if (group.conceptProperties) {
            for (const prop of group.conceptProperties) {
              ingredients.push({
                rxcui: prop.rxcui,
                name: prop.name,
                tty: prop.tty,
                isMultiple: prop.tty === 'MIN',
              });
            }
          }
        }

        return ingredients;
      },
      DEFAULT_TTL.LOOKUP
    );
  }

  /**
   * Gets drug classes for an RxCUI
   *
   * @param rxcui - RxNorm Concept Unique Identifier
   * @returns Array of drug classes
   */
  async getDrugClasses(rxcui: string): Promise<RxNormDrugClass[]> {
    const cacheKey = `rxnorm:classes:${rxcui}`;

    return cache.getOrSet(
      CACHE_PREFIX.RXNORM,
      cacheKey,
      async () => {
        const response = await this.request<RxClassResponse>(`/rxclass/class/byRxcui.json`, {
          rxcui,
        });

        if (!response.rxclassDrugInfoList?.rxclassDrugInfo) {
          return [];
        }

        return response.rxclassDrugInfoList.rxclassDrugInfo.map(info => ({
          classId: info.rxclassMinConceptItem.classId,
          className: info.rxclassMinConceptItem.className,
          classType: info.rxclassMinConceptItem.classType,
          source: info.rela || '',
        }));
      },
      DEFAULT_TTL.LOOKUP
    );
  }

  /**
   * Gets NDC codes for an RxCUI
   *
   * @param rxcui - RxNorm Concept Unique Identifier
   * @returns Array of NDC codes with package info
   */
  async getNDCs(rxcui: string): Promise<RxNormNDC[]> {
    const cacheKey = `rxnorm:ndcs:${rxcui}`;

    return cache.getOrSet(
      CACHE_PREFIX.RXNORM,
      cacheKey,
      async () => {
        const response = await this.request<RxNormNDCResponse>(`/rxcui/${rxcui}/allndcs.json`, {
          history: 0,
        });

        if (!response.ndcGroup?.ndcList?.ndc) {
          return [];
        }

        return response.ndcGroup.ndcList.ndc.map(ndc => ({
          ndc,
          rxcui,
        }));
      },
      DEFAULT_TTL.LOOKUP
    );
  }

  // ===========================================================================
  // ATC (Anatomical Therapeutic Chemical) Methods
  //
  // ATC is the WHO Collaborating Centre's classification of drugs by organ
  // system + therapeutic + pharmacological + chemical properties. WHOCC
  // distributes the official base under a paid subscription, but NLM's
  // RxClass exposes the same code/name pairs free via REST. These methods
  // wrap the relevant RxClass endpoints (same host as RxNorm proper, so
  // they reuse the rxnorm rate limiter, retry, and cache).
  //
  // Code shape: "A10BA02" → A (anatomical) / A10 (therapeutic) / A10B
  // (pharmacological) / A10BA (chemical) / A10BA02 (substance). RxClass
  // returns ATC1-4 codes and the full 7-char substance code; both are
  // surfaced.
  // ===========================================================================

  /**
   * Looks up ATC classifications for a drug by name. Returns one entry
   * per ATC code the drug belongs to (a single drug typically maps to one
   * substance code; combination products map to multiple).
   *
   * @param drugName - Free-text drug name (brand or generic)
   * @returns Array of ATC matches, or empty if drug is unknown
   */
  async getATCByDrugName(drugName: string): Promise<RxNormATCMatch[]> {
    const cacheKey = `atc:bydrug:${drugName.toLowerCase()}`;

    return cache.getOrSet(
      CACHE_PREFIX.RXNORM,
      cacheKey,
      async () => {
        const response = await this.request<RxClassResponse>(
          '/rxclass/class/byDrugName.json',
          { drugName, relaSource: 'ATC' },
        );

        const list = response.rxclassDrugInfoList?.rxclassDrugInfo ?? [];
        return list.map((info) => ({
          rxcui: info.minConcept?.rxcui ?? '',
          drug_name: info.minConcept?.name ?? '',
          tty: info.minConcept?.tty ?? '',
          atc_code: info.rxclassMinConceptItem.classId,
          atc_name: info.rxclassMinConceptItem.className,
          atc_level_type: info.rxclassMinConceptItem.classType,
        }));
      },
      DEFAULT_TTL.LOOKUP,
    );
  }

  /**
   * Looks up an ATC code's name and level type. Works for ATC levels 1-4
   * (1-5 character codes: e.g., `A`, `A10`, `A10B`, `A10BA`). Returns
   * null for level-5 substance codes (7 chars, e.g., `A10BA02`) — the
   * RxClass `byId` endpoint doesn't expose them and they should be looked
   * up via `getATCByDrugName` instead.
   *
   * @param atcCode - ATC code at level 1-4
   * @returns Code details or null if not found / wrong level
   */
  async getATCByCode(atcCode: string): Promise<RxNormATCClass | null> {
    const cacheKey = `atc:bycode:${atcCode.toUpperCase()}`;

    return cache.getOrSet(
      CACHE_PREFIX.RXNORM,
      cacheKey,
      async () => {
        try {
          const response = await this.request<RxClassByIdResponse>(
            '/rxclass/class/byId.json',
            { classId: atcCode },
          );
          const item = response.rxclassMinConceptList?.rxclassMinConcept?.[0];
          if (!item) return null;
          return {
            atc_code: item.classId,
            atc_name: item.className,
            atc_level_type: item.classType,
          };
        } catch (error) {
          if (error instanceof ApiError && error.code === 'NOT_FOUND') {
            return null;
          }
          throw error;
        }
      },
      DEFAULT_TTL.LOOKUP,
    );
  }

  /**
   * Lists drugs (RxNorm ingredients/multi-ingredient concepts) that belong
   * to a given ATC class. RxClass returns `nodeAttr` per drug with the
   * substance-level ATC code (`SourceId`); we surface that as
   * `source_atc_code` so callers can disambiguate when the input is an
   * ATC1-4 class containing multiple substances.
   *
   * @param atcCode - ATC code at any level (level 1-4 returns multiple
   *                  substances; level 5 returns a single substance)
   * @returns Array of drug members
   */
  async getATCMembers(atcCode: string): Promise<RxNormATCMember[]> {
    const cacheKey = `atc:members:${atcCode.toUpperCase()}`;

    return cache.getOrSet(
      CACHE_PREFIX.RXNORM,
      cacheKey,
      async () => {
        try {
          const response = await this.request<RxClassMembersResponse>(
            '/rxclass/classMembers.json',
            { classId: atcCode, relaSource: 'ATC' },
          );
          const list = response.drugMemberGroup?.drugMember ?? [];
          return list.map((m) => {
            const sourceId = m.nodeAttr?.find(
              (a) => a.attrName === 'SourceId',
            )?.attrValue;
            return {
              rxcui: m.minConcept.rxcui,
              name: m.minConcept.name,
              tty: m.minConcept.tty,
              source_atc_code: sourceId ?? '',
            };
          });
        } catch (error) {
          if (error instanceof ApiError && error.code === 'NOT_FOUND') {
            return [];
          }
          throw error;
        }
      },
      DEFAULT_TTL.LOOKUP,
    );
  }

  /**
   * Gets RxCUI by NDC code
   *
   * @param ndc - National Drug Code
   * @returns RxCUI or null if not found
   */
  async getRxcuiByNDC(ndc: string): Promise<string | null> {
    const cacheKey = `rxnorm:ndc2rxcui:${ndc}`;

    return cache.getOrSet(
      CACHE_PREFIX.RXNORM,
      cacheKey,
      async () => {
        const response = await this.request<RxNormIdGroupResponse>(`/ndcstatus.json`, {
          ndc,
        });

        if (!response.ndcStatus?.rxcui) {
          return null;
        }

        return response.ndcStatus.rxcui;
      },
      DEFAULT_TTL.LOOKUP
    );
  }
}

// =============================================================================
// RxNorm Types
// =============================================================================

/**
 * Drug search result
 */
export interface RxNormDrugSearchResult {
  drugs: RxNormDrug[];
}

/**
 * Basic drug concept
 */
export interface RxNormDrug {
  rxcui: string;
  name: string;
  synonym: string;
  tty: string;
  language: string;
}

/**
 * Approximate match result
 */
export interface RxNormApproximateMatch {
  rxcui: string;
  rxaui: string;
  name: string;
  score: number;
  rank: number;
}

/**
 * Full concept details
 */
export interface RxNormConcept {
  rxcui: string;
  name: string;
  synonym: string;
  tty: string;
  language: string;
  suppress: string;
  umlscui: string;
  status: string;
  remappedTo: string[];
}

/**
 * Related concept group
 */
export interface RxNormRelatedGroup {
  tty: string;
  concepts: RxNormDrug[];
}

/**
 * Ingredient
 */
export interface RxNormIngredient {
  rxcui: string;
  name: string;
  tty: string;
  isMultiple: boolean;
}

/**
 * Drug class
 */
export interface RxNormDrugClass {
  classId: string;
  className: string;
  classType: string;
  source: string;
}

/**
 * NDC code
 */
export interface RxNormNDC {
  ndc: string;
  rxcui: string;
}

/**
 * ATC classification match for a drug (one row per ATC code the drug
 * belongs to). The drug fields come from RxNorm; the atc_* fields come
 * from RxClass.
 */
export interface RxNormATCMatch {
  rxcui: string;
  drug_name: string;
  tty: string;
  atc_code: string;
  atc_name: string;
  atc_level_type: string;
}

/**
 * ATC class details for lookup by code (no drug context).
 */
export interface RxNormATCClass {
  atc_code: string;
  atc_name: string;
  atc_level_type: string;
}

/**
 * Drug that belongs to an ATC class. `source_atc_code` is the
 * substance-level (5th level, 7-char) ATC code RxClass attaches via
 * nodeAttr; useful for disambiguating when the queried class is at
 * ATC1-4 (e.g., `A10BA` returns metformin and phenformin, each with
 * its own substance-level code).
 */
export interface RxNormATCMember {
  rxcui: string;
  name: string;
  tty: string;
  source_atc_code: string;
}

// =============================================================================
// API Response Types
// =============================================================================

interface RxNormDrugsResponse {
  drugGroup?: {
    conceptGroup?: Array<{
      tty: string;
      conceptProperties?: Array<{
        rxcui: string;
        name: string;
        synonym?: string;
        tty: string;
        language?: string;
      }>;
    }>;
  };
}

interface RxNormApproxResponse {
  approximateGroup?: {
    candidate?: Array<{
      rxcui: string;
      rxaui?: string;
      name?: string;
      score: string;
      rank: string;
    }>;
  };
}

interface RxNormPropertiesResponse {
  properties?: {
    rxcui: string;
    name: string;
    synonym?: string;
    tty: string;
    language?: string;
    suppress?: string;
    umlscui?: string;
  };
}

interface RxNormStatusResponse {
  rxcuiStatus?: {
    status: string;
    remappedTo?: string[];
  };
}

interface RxNormAllRelatedResponse {
  allRelatedGroup?: {
    conceptGroup?: Array<{
      tty: string;
      conceptProperties?: Array<{
        rxcui: string;
        name: string;
        synonym?: string;
        tty: string;
        language?: string;
      }>;
    }>;
  };
}

interface RxNormRelatedResponse {
  relatedGroup?: {
    conceptGroup?: Array<{
      tty: string;
      conceptProperties?: Array<{
        rxcui: string;
        name: string;
        synonym?: string;
        tty: string;
        language?: string;
      }>;
    }>;
  };
}

interface RxClassResponse {
  rxclassDrugInfoList?: {
    rxclassDrugInfo?: Array<{
      // Present when the query is byDrugName / byRxcui (the drug context
      // is part of the response). Absent for other RxClass shapes.
      minConcept?: {
        rxcui: string;
        name: string;
        tty: string;
      };
      rxclassMinConceptItem: {
        classId: string;
        className: string;
        classType: string;
      };
      rela?: string;
    }>;
  };
}

interface RxClassByIdResponse {
  rxclassMinConceptList?: {
    rxclassMinConcept?: Array<{
      classId: string;
      className: string;
      classType: string;
    }>;
  };
}

interface RxClassMembersResponse {
  drugMemberGroup?: {
    drugMember?: Array<{
      minConcept: {
        rxcui: string;
        name: string;
        tty: string;
      };
      nodeAttr?: Array<{ attrName: string; attrValue: string }>;
    }>;
  };
}

interface RxNormNDCResponse {
  ndcGroup?: {
    ndcList?: {
      ndc?: string[];
    };
  };
}

interface RxNormIdGroupResponse {
  ndcStatus?: {
    rxcui?: string;
  };
}

/** Singleton client instance */
let rxnormClientInstance: RxNormClient | null = null;

/**
 * Gets or creates the RxNorm API client singleton
 * @returns RxNorm API client instance
 */
export function getRxNormClient(): RxNormClient {
  if (!rxnormClientInstance) {
    rxnormClientInstance = new RxNormClient();
  }
  return rxnormClientInstance;
}
