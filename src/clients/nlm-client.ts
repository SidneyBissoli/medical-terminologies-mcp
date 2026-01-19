import axios, { AxiosInstance, AxiosError } from 'axios';
import { cache, CACHE_PREFIX, DEFAULT_TTL } from '../utils/cache.js';
import { withRetry } from '../utils/retry.js';
import { rateLimiters } from '../utils/rate-limiter.js';
import { ApiError } from '../types/index.js';

/**
 * NLM Clinical Tables API Configuration
 */
const NLM_CONFIG = {
  /** Base URL for Clinical Tables API (LOINC) */
  clinicalTablesUrl: 'https://clinicaltables.nlm.nih.gov/api',
  /** LOINC answers endpoint */
  loincAnswersUrl: 'https://clinicaltables.nlm.nih.gov/loinc_answers',
  /** LOINC forms endpoint */
  loincFormsUrl: 'https://clinicaltables.nlm.nih.gov/loinc_form_definitions',
} as const;

/**
 * Default LOINC fields to return in search results
 */
const DEFAULT_LOINC_FIELDS = [
  'LOINC_NUM',
  'LONG_COMMON_NAME',
  'COMPONENT',
  'PROPERTY',
  'TIME_ASPCT',
  'SYSTEM',
  'SCALE_TYP',
  'METHOD_TYP',
  'CLASS',
  'STATUS',
  'SHORTNAME',
];

/**
 * NLM API Client for LOINC, RxNorm, and MeSH
 *
 * Handles:
 * - Rate limiting (10 requests/second for courtesy)
 * - Retry with exponential backoff
 * - Response caching
 */
export class NLMClient {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Makes a request to the NLM API
   *
   * @param url - Full URL to request
   * @param params - Query parameters
   * @returns API response data
   * @throws ApiError on request failure
   */
  async request<T>(
    url: string,
    params: Record<string, string | number | boolean> = {}
  ): Promise<T> {
    // Apply rate limiting
    await rateLimiters.nlm.acquire();

    return withRetry(
      async () => {
        try {
          const response = await this.httpClient.get<T>(url, { params });
          return response.data;
        } catch (error) {
          if (error instanceof AxiosError) {
            const status = error.response?.status;
            const message = error.response?.data?.message || error.message;

            if (status === 404) {
              throw new ApiError(`Resource not found`, 'NOT_FOUND', status);
            }
            if (status === 429) {
              throw new ApiError('Rate limit exceeded', 'RATE_LIMIT', status);
            }

            throw new ApiError(
              `NLM API error: ${message}`,
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
  // LOINC Methods
  // ===========================================================================

  /**
   * Searches for LOINC codes by term
   *
   * @param query - Search term
   * @param maxResults - Maximum results to return (default: 25)
   * @returns Array of LOINC items
   */
  async searchLOINC(query: string, maxResults: number = 25): Promise<LOINCSearchResponse> {
    const cacheKey = `loinc:search:${query}:${maxResults}`;

    return cache.getOrSet(
      CACHE_PREFIX.LOINC,
      cacheKey,
      async () => {
        const url = `${NLM_CONFIG.clinicalTablesUrl}/loinc_items/v3/search`;
        const response = await this.request<[number, string[], null, Array<string[]>]>(url, {
          terms: query,
          maxList: maxResults,
          df: DEFAULT_LOINC_FIELDS.join(','),
        });

        // Parse the Clinical Tables API response format
        // [totalCount, codes, null, [fields arrays]]
        const [totalCount, codes, , fieldsArrays] = response;

        const items: LOINCItem[] = codes.map((code, index) => {
          const fields = fieldsArrays[index] || [];
          return {
            LOINC_NUM: code,
            LONG_COMMON_NAME: fields[1] || '',
            COMPONENT: fields[2] || '',
            PROPERTY: fields[3] || '',
            TIME_ASPCT: fields[4] || '',
            SYSTEM: fields[5] || '',
            SCALE_TYP: fields[6] || '',
            METHOD_TYP: fields[7] || '',
            CLASS: fields[8] || '',
            STATUS: fields[9] || '',
            SHORTNAME: fields[10] || '',
          };
        });

        return {
          totalCount,
          items,
        };
      },
      DEFAULT_TTL.SEARCH
    );
  }

  /**
   * Gets detailed information for a specific LOINC code
   *
   * @param loincNum - LOINC number (e.g., "2339-0")
   * @returns LOINC item details or null if not found
   */
  async getLOINCDetails(loincNum: string): Promise<LOINCItem | null> {
    const cacheKey = `loinc:details:${loincNum}`;

    return cache.getOrSet(
      CACHE_PREFIX.LOINC,
      cacheKey,
      async () => {
        // Search for exact LOINC code
        const url = `${NLM_CONFIG.clinicalTablesUrl}/loinc_items/v3/search`;
        const response = await this.request<[number, string[], null, Array<string[]>]>(url, {
          terms: loincNum,
          maxList: 1,
          df: DEFAULT_LOINC_FIELDS.join(','),
          ef: 'LOINC_NUM,LONG_COMMON_NAME,COMPONENT,PROPERTY,TIME_ASPCT,SYSTEM,SCALE_TYP,METHOD_TYP,CLASS,STATUS,SHORTNAME,EXAMPLE_UNITS,EXAMPLE_UCUM_UNITS,ORDER_OBS,HL7_FIELD_SUBFIELD_ID,RELATEDNAMES2,CONSUMER_NAME,CLASSTYPE',
        });

        const [totalCount, codes, , fieldsArrays] = response;

        if (totalCount === 0 || codes.length === 0) {
          return null;
        }

        // Find exact match
        const exactIndex = codes.findIndex(code => code === loincNum);
        if (exactIndex === -1) {
          return null;
        }

        const fields = fieldsArrays[exactIndex] || [];
        return {
          LOINC_NUM: codes[exactIndex],
          LONG_COMMON_NAME: fields[1] || '',
          COMPONENT: fields[2] || '',
          PROPERTY: fields[3] || '',
          TIME_ASPCT: fields[4] || '',
          SYSTEM: fields[5] || '',
          SCALE_TYP: fields[6] || '',
          METHOD_TYP: fields[7] || '',
          CLASS: fields[8] || '',
          STATUS: fields[9] || '',
          SHORTNAME: fields[10] || '',
        };
      },
      DEFAULT_TTL.LOOKUP
    );
  }

  /**
   * Gets answers for a LOINC code (for forms/questionnaires)
   *
   * @param loincNum - LOINC number
   * @returns Array of answers or empty array if not applicable
   */
  async getLOINCAnswers(loincNum: string): Promise<LOINCAnswer[]> {
    const cacheKey = `loinc:answers:${loincNum}`;

    return cache.getOrSet(
      CACHE_PREFIX.LOINC,
      cacheKey,
      async () => {
        try {
          const response = await this.request<LOINCAnswersResponse>(
            NLM_CONFIG.loincAnswersUrl,
            { loinc_num: loincNum }
          );

          if (!response || !Array.isArray(response)) {
            return [];
          }

          return response.map(item => ({
            answerCode: item.AnswerListId || '',
            answerString: item.DisplayText || item.AnswerStringId || '',
            sequence: item.Sequence || 0,
          }));
        } catch (error) {
          // Return empty array if answers not available
          if (error instanceof ApiError && error.code === 'NOT_FOUND') {
            return [];
          }
          throw error;
        }
      },
      DEFAULT_TTL.LOOKUP
    );
  }

  /**
   * Gets form/panel information for a LOINC code
   *
   * @param loincNum - LOINC number
   * @returns Panel information or null if not a panel
   */
  async getLOINCPanel(loincNum: string): Promise<LOINCPanel | null> {
    const cacheKey = `loinc:panel:${loincNum}`;

    return cache.getOrSet(
      CACHE_PREFIX.LOINC,
      cacheKey,
      async () => {
        try {
          const response = await this.request<LOINCFormResponse>(
            NLM_CONFIG.loincFormsUrl,
            { loinc_num: loincNum }
          );

          if (!response || !response.items || response.items.length === 0) {
            return null;
          }

          const panelItems = response.items.map(item => ({
            loincNum: item.questionCode || '',
            name: item.question || '',
            required: item.required === '1' || item.required === true,
            sequence: item.displayOrder || 0,
          }));

          return {
            loincNum,
            name: response.name || `Panel ${loincNum}`,
            items: panelItems,
          };
        } catch (error) {
          // Return null if panel info not available
          if (error instanceof ApiError && error.code === 'NOT_FOUND') {
            return null;
          }
          throw error;
        }
      },
      DEFAULT_TTL.LOOKUP
    );
  }
}

// =============================================================================
// LOINC Types
// =============================================================================

/**
 * LOINC search response
 */
export interface LOINCSearchResponse {
  totalCount: number;
  items: LOINCItem[];
}

/**
 * LOINC item
 */
export interface LOINCItem {
  LOINC_NUM: string;
  LONG_COMMON_NAME: string;
  COMPONENT: string;
  PROPERTY: string;
  TIME_ASPCT: string;
  SYSTEM: string;
  SCALE_TYP: string;
  METHOD_TYP: string;
  CLASS: string;
  STATUS: string;
  SHORTNAME: string;
}

/**
 * LOINC answer for questionnaires
 */
export interface LOINCAnswer {
  answerCode: string;
  answerString: string;
  sequence: number;
}

/**
 * LOINC panel (collection of related tests)
 */
export interface LOINCPanel {
  loincNum: string;
  name: string;
  items: LOINCPanelItem[];
}

/**
 * Item within a LOINC panel
 */
export interface LOINCPanelItem {
  loincNum: string;
  name: string;
  required: boolean;
  sequence: number;
}

/**
 * Raw answer response from NLM API
 */
interface LOINCAnswersResponse extends Array<{
  AnswerListId?: string;
  DisplayText?: string;
  AnswerStringId?: string;
  Sequence?: number;
}> {}

/**
 * Raw form response from NLM API
 */
interface LOINCFormResponse {
  name?: string;
  items?: Array<{
    questionCode?: string;
    question?: string;
    required?: string | boolean;
    displayOrder?: number;
  }>;
}

/** Singleton client instance */
let nlmClientInstance: NLMClient | null = null;

/**
 * Gets or creates the NLM API client singleton
 * @returns NLM API client instance
 */
export function getNLMClient(): NLMClient {
  if (!nlmClientInstance) {
    nlmClientInstance = new NLMClient();
  }
  return nlmClientInstance;
}
