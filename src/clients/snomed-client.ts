/**
 * SNOMED CT API Client
 *
 * Provides access to SNOMED CT through the Snowstorm terminology server.
 *
 * ⚠️ DISCLAIMER: SNOMED CT content is for reference purposes only.
 * Production use requires an IHTSDO (SNOMED International) license.
 *
 * @see https://browser.ihtsdotools.org/snowstorm/snomed-ct/
 * @author Sidney Bissoli
 * @license MIT
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { cache, CACHE_PREFIX, DEFAULT_TTL } from '../utils/cache.js';
import { withRetry } from '../utils/retry.js';
import { rateLimiters } from '../utils/rate-limiter.js';
import { ApiError } from '../types/index.js';
import { createClientLogger } from '../utils/logger.js';

const log = createClientLogger('snomed');

/**
 * SNOMED CT license disclaimer
 */
export const SNOMED_DISCLAIMER = `⚠️ SNOMED CT content is for reference purposes only. Production use requires IHTSDO license.`;

/**
 * SNOMED CT API Configuration
 */
const SNOMED_CONFIG = {
  /** Base URL for Snowstorm browser API */
  baseUrl: 'https://browser.ihtsdotools.org/snowstorm/snomed-ct',
  /** Default branch (International Edition) */
  branch: 'MAIN',
} as const;

/**
 * SNOMED CT API Client
 *
 * Handles:
 * - Rate limiting (10 requests/second)
 * - Retry with exponential backoff
 * - Response caching
 */
export class SNOMEDClient {
  private httpClient: AxiosInstance;
  private branch: string;

  constructor(branch: string = SNOMED_CONFIG.branch) {
    this.branch = branch;
    this.httpClient = axios.create({
      baseURL: SNOMED_CONFIG.baseUrl,
      timeout: 60000, // 60 seconds for slow connections
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'en',
        'User-Agent': 'medical-terminologies-mcp/1.0.0',
      },
    });
  }

  /**
   * Makes a request to the SNOMED CT API
   */
  private async request<T>(
    path: string,
    params: Record<string, string | number | boolean> = {}
  ): Promise<T> {
    await rateLimiters.snomed.acquire();

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
              throw new ApiError('Resource not found', 'NOT_FOUND', status);
            }
            if (status === 429) {
              throw new ApiError('Rate limit exceeded', 'RATE_LIMIT', status);
            }

            throw new ApiError(
              `SNOMED CT API error: ${message}`,
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
  // SNOMED CT Methods
  // ===========================================================================

  /**
   * Searches for SNOMED CT concepts by term
   *
   * @param term - Search term
   * @param activeOnly - Only return active concepts (default: true)
   * @param limit - Maximum results (default: 25)
   * @returns Array of matching concepts
   */
  async searchConcepts(
    term: string,
    activeOnly: boolean = true,
    limit: number = 25
  ): Promise<SNOMEDSearchResult[]> {
    const cacheKey = `snomed:search:${term}:${activeOnly}:${limit}`;

    return cache.getOrSet(
      CACHE_PREFIX.SNOMED,
      cacheKey,
      async () => {
        const response = await this.request<SNOMEDSearchResponse>(
          `/${this.branch}/concepts`,
          {
            term,
            activeFilter: activeOnly,
            limit,
            offset: 0,
          }
        );

        if (!response.items) {
          return [];
        }

        return response.items.map(item => ({
          conceptId: item.conceptId,
          fsn: item.fsn?.term || '',
          pt: item.pt?.term || '',
          active: item.active,
          definitionStatus: item.definitionStatus || '',
          moduleId: item.moduleId || '',
        }));
      },
      DEFAULT_TTL.SEARCH
    );
  }

  /**
   * Gets concept details by SCTID
   *
   * @param sctid - SNOMED CT Identifier
   * @returns Concept details or null if not found
   */
  async getConcept(sctid: string): Promise<SNOMEDConcept | null> {
    const cacheKey = `snomed:concept:${sctid}`;

    return cache.getOrSet(
      CACHE_PREFIX.SNOMED,
      cacheKey,
      async () => {
        try {
          const response = await this.request<SNOMEDConceptResponse>(
            `/${this.branch}/concepts/${sctid}`
          );

          if (!response) {
            return null;
          }

          return {
            conceptId: response.conceptId,
            fsn: response.fsn?.term || '',
            pt: response.pt?.term || '',
            active: response.active,
            effectiveTime: response.effectiveTime || '',
            definitionStatus: response.definitionStatus || '',
            moduleId: response.moduleId || '',
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
   * Gets parent concepts (IS-A relationships)
   *
   * @param sctid - SNOMED CT Identifier
   * @returns Array of parent concepts
   */
  async getParents(sctid: string): Promise<SNOMEDHierarchyConcept[]> {
    const cacheKey = `snomed:parents:${sctid}`;

    return cache.getOrSet(
      CACHE_PREFIX.SNOMED,
      cacheKey,
      async () => {
        try {
          const response = await this.request<SNOMEDHierarchyConcept[]>(
            `/browser/${this.branch}/concepts/${sctid}/parents`,
            { form: 'inferred' }
          );

          if (!Array.isArray(response)) {
            return [];
          }

          return response.map(item => ({
            conceptId: item.conceptId,
            fsn: typeof item.fsn === 'object' ? item.fsn?.term || '' : item.fsn || '',
            pt: typeof item.pt === 'object' ? item.pt?.term || '' : item.pt || '',
            active: item.active,
            definitionStatus: item.definitionStatus || '',
          }));
        } catch (error) {
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
   * Gets child concepts (IS-A relationships)
   *
   * @param sctid - SNOMED CT Identifier
   * @param limit - Maximum results (default: 50)
   * @returns Array of child concepts
   */
  async getChildren(sctid: string, limit: number = 50): Promise<SNOMEDHierarchyConcept[]> {
    const cacheKey = `snomed:children:${sctid}:${limit}`;

    return cache.getOrSet(
      CACHE_PREFIX.SNOMED,
      cacheKey,
      async () => {
        try {
          const response = await this.request<SNOMEDHierarchyConcept[]>(
            `/browser/${this.branch}/concepts/${sctid}/children`,
            { form: 'inferred', limit }
          );

          if (!Array.isArray(response)) {
            return [];
          }

          return response.map(item => ({
            conceptId: item.conceptId,
            fsn: typeof item.fsn === 'object' ? item.fsn?.term || '' : item.fsn || '',
            pt: typeof item.pt === 'object' ? item.pt?.term || '' : item.pt || '',
            active: item.active,
            definitionStatus: item.definitionStatus || '',
          }));
        } catch (error) {
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
   * Gets all descriptions for a concept
   *
   * @param sctid - SNOMED CT Identifier
   * @returns Array of descriptions
   */
  async getDescriptions(sctid: string): Promise<SNOMEDDescription[]> {
    const cacheKey = `snomed:descriptions:${sctid}`;

    return cache.getOrSet(
      CACHE_PREFIX.SNOMED,
      cacheKey,
      async () => {
        try {
          const response = await this.request<SNOMEDDescriptionsResponse>(
            `/${this.branch}/concepts/${sctid}/descriptions`
          );

          if (!response.conceptDescriptions) {
            return [];
          }

          return response.conceptDescriptions.map(desc => ({
            descriptionId: desc.descriptionId,
            term: desc.term,
            type: desc.type || this.getDescriptionType(desc.typeId),
            typeId: desc.typeId,
            lang: desc.lang || 'en',
            active: desc.active,
            caseSignificance: desc.caseSignificance || '',
            acceptabilityMap: desc.acceptabilityMap || {},
          }));
        } catch (error) {
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
   * Executes an ECL (Expression Constraint Language) query
   *
   * @param ecl - ECL expression
   * @param limit - Maximum results (default: 25)
   * @returns Array of matching concepts
   */
  async executeECL(ecl: string, limit: number = 25): Promise<SNOMEDSearchResult[]> {
    const cacheKey = `snomed:ecl:${ecl}:${limit}`;

    return cache.getOrSet(
      CACHE_PREFIX.SNOMED,
      cacheKey,
      async () => {
        const response = await this.request<SNOMEDSearchResponse>(
          `/${this.branch}/concepts`,
          {
            ecl,
            limit,
            offset: 0,
          }
        );

        if (!response.items) {
          return [];
        }

        return response.items.map(item => ({
          conceptId: item.conceptId,
          fsn: item.fsn?.term || '',
          pt: item.pt?.term || '',
          active: item.active,
          definitionStatus: item.definitionStatus || '',
          moduleId: item.moduleId || '',
        }));
      },
      DEFAULT_TTL.SEARCH
    );
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Gets description type name from type ID
   */
  private getDescriptionType(typeId: string): string {
    const types: Record<string, string> = {
      '900000000000003001': 'FSN', // Fully Specified Name
      '900000000000013009': 'SYN', // Synonym
      '900000000000550004': 'DEF', // Definition
    };
    return types[typeId] || 'OTHER';
  }
}

// =============================================================================
// SNOMED CT Types
// =============================================================================

/**
 * Search result
 */
export interface SNOMEDSearchResult {
  conceptId: string;
  fsn: string;
  pt: string;
  active: boolean;
  definitionStatus: string;
  moduleId: string;
}

/**
 * Full concept details
 */
export interface SNOMEDConcept {
  conceptId: string;
  fsn: string;
  pt: string;
  active: boolean;
  effectiveTime: string;
  definitionStatus: string;
  moduleId: string;
}

/**
 * Hierarchy concept (parent/child)
 */
export interface SNOMEDHierarchyConcept {
  conceptId: string;
  fsn: string | { term: string };
  pt: string | { term: string };
  active: boolean;
  definitionStatus: string;
}

/**
 * Description
 */
export interface SNOMEDDescription {
  descriptionId: string;
  term: string;
  type: string;
  typeId: string;
  lang: string;
  active: boolean;
  caseSignificance: string;
  acceptabilityMap: Record<string, string>;
}

// =============================================================================
// API Response Types
// =============================================================================

interface SNOMEDSearchResponse {
  items?: Array<{
    conceptId: string;
    fsn?: { term: string };
    pt?: { term: string };
    active: boolean;
    definitionStatus?: string;
    moduleId?: string;
  }>;
  total?: number;
}

interface SNOMEDConceptResponse {
  conceptId: string;
  fsn?: { term: string };
  pt?: { term: string };
  active: boolean;
  effectiveTime?: string;
  definitionStatus?: string;
  moduleId?: string;
}

interface SNOMEDDescriptionsResponse {
  conceptDescriptions?: Array<{
    descriptionId: string;
    term: string;
    type?: string;
    typeId: string;
    lang?: string;
    active: boolean;
    caseSignificance?: string;
    acceptabilityMap?: Record<string, string>;
  }>;
}

/** Singleton client instance */
let snomedClientInstance: SNOMEDClient | null = null;

/**
 * Gets or creates the SNOMED CT API client singleton
 * @returns SNOMED CT API client instance
 */
export function getSNOMEDClient(): SNOMEDClient {
  if (!snomedClientInstance) {
    snomedClientInstance = new SNOMEDClient();
  }
  return snomedClientInstance;
}
