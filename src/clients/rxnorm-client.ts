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

import axios, { AxiosInstance, AxiosError } from 'axios';
import { cache, CACHE_PREFIX, DEFAULT_TTL } from '../utils/cache.js';
import { withRetry } from '../utils/retry.js';
import { rateLimiters } from '../utils/rate-limiter.js';
import { ApiError } from '../types/index.js';
import { createClientLogger } from '../utils/logger.js';

const log = createClientLogger('rxnorm');

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
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
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

    const startTime = Date.now();
    log.debug({ path, params }, 'Starting API request');

    return withRetry(
      async () => {
        try {
          const response = await this.httpClient.get<T>(path, { params });
          const duration = Date.now() - startTime;
          log.info({ path, status: response.status, durationMs: duration }, 'API request completed');
          return response.data;
        } catch (error) {
          if (error instanceof AxiosError) {
            const status = error.response?.status;
            const message = error.response?.data?.message || error.message;
            const duration = Date.now() - startTime;

            log.error({ path, status, error: message, durationMs: duration }, 'API request failed');

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
              error.response?.data
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
      rxclassMinConceptItem: {
        classId: string;
        className: string;
        classType: string;
      };
      rela?: string;
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
