/**
 * MeSH (Medical Subject Headings) API Client
 *
 * Provides access to MeSH through the NLM Linked Data API.
 *
 * @see https://id.nlm.nih.gov/mesh/
 * @author Sidney Bissoli
 * @license MIT
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { cache, CACHE_PREFIX, DEFAULT_TTL } from '../utils/cache.js';
import { withRetry } from '../utils/retry.js';
import { rateLimiters } from '../utils/rate-limiter.js';
import { ApiError } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('mesh-client');

/**
 * MeSH API Configuration
 */
const MESH_CONFIG = {
  /** Base URL for MeSH Linked Data API */
  baseUrl: 'https://id.nlm.nih.gov/mesh',
} as const;

/**
 * MeSH API Client
 *
 * Handles:
 * - Rate limiting (10 requests/second, shared with NLM)
 * - Retry with exponential backoff
 * - Response caching
 */
export class MeSHClient {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: MESH_CONFIG.baseUrl,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Makes a request to the MeSH API
   */
  private async request<T>(
    path: string,
    params: Record<string, string | number | boolean> = {}
  ): Promise<T> {
    await rateLimiters.nlm.acquire();

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
              `MeSH API error: ${message}`,
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
  // MeSH Methods
  // ===========================================================================

  /**
   * Searches for MeSH descriptors by label
   *
   * @param term - Search term
   * @param match - Match type: 'exact', 'contains', 'startswith'
   * @param limit - Maximum results (default: 25)
   * @returns Array of matching descriptors
   */
  async searchDescriptors(
    term: string,
    match: 'exact' | 'contains' | 'startswith' = 'contains',
    limit: number = 25
  ): Promise<MeSHSearchResult[]> {
    const cacheKey = `mesh:search:${term}:${match}:${limit}`;

    return cache.getOrSet(
      CACHE_PREFIX.MESH,
      cacheKey,
      async () => {
        const response = await this.request<MeSHLookupResponse>('/lookup/descriptor', {
          label: term,
          match,
          limit,
        });

        if (!response || !Array.isArray(response)) {
          return [];
        }

        return response.map(item => ({
          id: this.extractMeshId(item.resource),
          uri: item.resource,
          label: item.label,
        }));
      },
      DEFAULT_TTL.SEARCH
    );
  }

  /**
   * Gets descriptor details by MeSH ID
   *
   * @param meshId - MeSH Descriptor ID (e.g., 'D015242')
   * @returns Descriptor details or null if not found
   */
  async getDescriptor(meshId: string): Promise<MeSHDescriptor | null> {
    const cacheKey = `mesh:descriptor:${meshId}`;

    return cache.getOrSet(
      CACHE_PREFIX.MESH,
      cacheKey,
      async () => {
        try {
          const response = await this.request<MeSHDescriptorResponse>(`/${meshId}.json`);

          if (!response) {
            return null;
          }

          // Parse the JSON-LD response
          return this.parseDescriptor(meshId, response);
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
   * Gets tree numbers for a descriptor
   *
   * @param meshId - MeSH Descriptor ID
   * @returns Array of tree numbers
   */
  async getTreeNumbers(meshId: string): Promise<MeSHTreeNumber[]> {
    const cacheKey = `mesh:tree:${meshId}`;

    return cache.getOrSet(
      CACHE_PREFIX.MESH,
      cacheKey,
      async () => {
        try {
          const response = await this.request<MeSHDescriptorResponse>(`/${meshId}.json`);

          if (!response) {
            return [];
          }

          const treeNumbers = this.extractTreeNumbers(response);
          return treeNumbers;
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
   * Gets allowed qualifiers for a descriptor
   *
   * @param meshId - MeSH Descriptor ID
   * @returns Array of allowed qualifiers
   */
  async getAllowedQualifiers(meshId: string): Promise<MeSHQualifier[]> {
    const cacheKey = `mesh:qualifiers:${meshId}`;

    return cache.getOrSet(
      CACHE_PREFIX.MESH,
      cacheKey,
      async () => {
        try {
          const response = await this.request<MeSHDescriptorResponse>(`/${meshId}.json`);

          if (!response) {
            return [];
          }

          const qualifiers = this.extractQualifiers(response);
          return qualifiers;
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

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Extracts MeSH ID from URI
   */
  private extractMeshId(uri: string): string {
    const match = uri.match(/mesh\/([A-Z]\d+)$/);
    return match ? match[1] : uri;
  }

  /**
   * Parses descriptor response into structured format
   */
  private parseDescriptor(meshId: string, response: MeSHDescriptorResponse): MeSHDescriptor {
    const mainEntity = this.findMainEntity(response, meshId);

    const descriptor: MeSHDescriptor = {
      id: meshId,
      uri: `${MESH_CONFIG.baseUrl}/${meshId}`,
      label: '',
      scopeNote: '',
      treeNumbers: [],
      concepts: [],
      qualifiers: [],
    };

    if (!mainEntity) {
      return descriptor;
    }

    // Extract label
    if (mainEntity['rdfs:label']) {
      descriptor.label = this.extractValue(mainEntity['rdfs:label']);
    }

    // Extract scope note
    if (mainEntity['meshv:scopeNote']) {
      descriptor.scopeNote = this.extractValue(mainEntity['meshv:scopeNote']);
    }

    // Extract tree numbers
    descriptor.treeNumbers = this.extractTreeNumbers(response);

    // Extract concepts
    descriptor.concepts = this.extractConcepts(response);

    // Extract qualifiers
    descriptor.qualifiers = this.extractQualifiers(response);

    return descriptor;
  }

  /**
   * Finds the main entity in JSON-LD response
   */
  private findMainEntity(response: MeSHDescriptorResponse, meshId: string): Record<string, unknown> | null {
    if (!response['@graph']) {
      return response as unknown as Record<string, unknown>;
    }

    const graph = response['@graph'];
    if (!Array.isArray(graph)) {
      return null;
    }

    // Find the descriptor entity
    const meshUri = `http://id.nlm.nih.gov/mesh/${meshId}`;
    return graph.find(
      item => item['@id'] === meshUri || item['@id'] === `${MESH_CONFIG.baseUrl}/${meshId}`
    ) as Record<string, unknown> | null;
  }

  /**
   * Extracts string value from JSON-LD property
   */
  private extractValue(prop: unknown): string {
    if (typeof prop === 'string') {
      return prop;
    }
    if (Array.isArray(prop)) {
      const item = prop[0];
      if (typeof item === 'string') {
        return item;
      }
      if (item && typeof item === 'object' && '@value' in item) {
        return String((item as { '@value': unknown })['@value']);
      }
    }
    if (prop && typeof prop === 'object' && '@value' in prop) {
      return String((prop as { '@value': unknown })['@value']);
    }
    return '';
  }

  /**
   * Extracts tree numbers from response
   */
  private extractTreeNumbers(response: MeSHDescriptorResponse): MeSHTreeNumber[] {
    const treeNumbers: MeSHTreeNumber[] = [];
    const graph = response['@graph'];

    if (!Array.isArray(graph)) {
      return treeNumbers;
    }

    for (const item of graph) {
      if (item['@type'] === 'meshv:TreeNumber' && item['rdfs:label']) {
        treeNumbers.push({
          treeNumber: this.extractValue(item['rdfs:label']),
          uri: item['@id'] || '',
        });
      }
    }

    return treeNumbers;
  }

  /**
   * Extracts concepts from response
   */
  private extractConcepts(response: MeSHDescriptorResponse): MeSHConcept[] {
    const concepts: MeSHConcept[] = [];
    const graph = response['@graph'];

    if (!Array.isArray(graph)) {
      return concepts;
    }

    for (const item of graph) {
      if (item['@type'] === 'meshv:Concept' && item['rdfs:label']) {
        const concept: MeSHConcept = {
          uri: item['@id'] || '',
          label: this.extractValue(item['rdfs:label']),
          isPreferred: false,
          terms: [],
        };

        // Check if preferred
        if (item['meshv:preferredConcept']) {
          concept.isPreferred = true;
        }

        concepts.push(concept);
      }
    }

    return concepts;
  }

  /**
   * Extracts qualifiers from response
   */
  private extractQualifiers(response: MeSHDescriptorResponse): MeSHQualifier[] {
    const qualifiers: MeSHQualifier[] = [];
    const graph = response['@graph'];

    if (!Array.isArray(graph)) {
      return qualifiers;
    }

    // Find the main descriptor and get allowed qualifiers
    for (const item of graph) {
      if (item['meshv:allowableQualifier']) {
        const allowable = item['meshv:allowableQualifier'];
        const qualifierRefs = Array.isArray(allowable) ? allowable : [allowable];

        for (const ref of qualifierRefs) {
          const uri = typeof ref === 'string' ? ref : ref?.['@id'];
          if (uri) {
            const id = this.extractMeshId(uri);
            qualifiers.push({
              id,
              uri,
              label: '', // Would need separate lookup to get labels
            });
          }
        }
      }
    }

    return qualifiers;
  }
}

// =============================================================================
// MeSH Types
// =============================================================================

/**
 * Search result
 */
export interface MeSHSearchResult {
  id: string;
  uri: string;
  label: string;
}

/**
 * Full descriptor
 */
export interface MeSHDescriptor {
  id: string;
  uri: string;
  label: string;
  scopeNote: string;
  treeNumbers: MeSHTreeNumber[];
  concepts: MeSHConcept[];
  qualifiers: MeSHQualifier[];
}

/**
 * Tree number
 */
export interface MeSHTreeNumber {
  treeNumber: string;
  uri: string;
}

/**
 * Concept
 */
export interface MeSHConcept {
  uri: string;
  label: string;
  isPreferred: boolean;
  terms: string[];
}

/**
 * Qualifier
 */
export interface MeSHQualifier {
  id: string;
  uri: string;
  label: string;
}

// =============================================================================
// API Response Types
// =============================================================================

type MeSHLookupResponse = Array<{
  resource: string;
  label: string;
}>;

interface MeSHDescriptorResponse {
  '@graph'?: Array<{
    '@id'?: string;
    '@type'?: string;
    'rdfs:label'?: unknown;
    'meshv:scopeNote'?: unknown;
    'meshv:allowableQualifier'?: unknown;
    'meshv:preferredConcept'?: unknown;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** Singleton client instance */
let meshClientInstance: MeSHClient | null = null;

/**
 * Gets or creates the MeSH API client singleton
 * @returns MeSH API client instance
 */
export function getMeSHClient(): MeSHClient {
  if (!meshClientInstance) {
    meshClientInstance = new MeSHClient();
  }
  return meshClientInstance;
}
