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
import { extractErrorMessage } from '../utils/extract-error-message.js';

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

    return withRetry(
      async () => {
        try {
          const response = await this.httpClient.get<T>(path, { params });
          return response.data;
        } catch (error) {
          if (error instanceof AxiosError) {
            const status = error.response?.status;
            const message = extractErrorMessage(error);

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
    const raw = await this.fetchDescriptorRaw(meshId);
    if (!raw) return null;
    return this.parseDescriptor(meshId, raw);
  }

  /**
   * Gets tree numbers for a descriptor
   *
   * @param meshId - MeSH Descriptor ID
   * @returns Array of tree numbers
   */
  async getTreeNumbers(meshId: string): Promise<MeSHTreeNumber[]> {
    const raw = await this.fetchDescriptorRaw(meshId);
    if (!raw) return [];
    return this.extractTreeNumbers(raw);
  }

  /**
   * Gets allowed qualifiers for a descriptor.
   *
   * The descriptor JSON-LD only references qualifiers by URI; their labels
   * live in each qualifier's own resource. This method fetches the
   * descriptor once (cached), extracts the qualifier URIs, then fetches
   * each qualifier's label in parallel via the shared NLM rate limiter.
   * Qualifier labels are cached separately with a long TTL since they
   * rarely change.
   *
   * @param meshId - MeSH Descriptor ID
   * @returns Array of allowed qualifiers with labels populated
   */
  async getAllowedQualifiers(meshId: string): Promise<MeSHQualifier[]> {
    const raw = await this.fetchDescriptorRaw(meshId);
    if (!raw) return [];

    const refs = this.extractQualifierRefs(raw);
    if (refs.length === 0) return [];

    const settled = await Promise.allSettled(
      refs.map((ref) => this.fetchQualifierLabel(ref.id)),
    );

    return refs.map((ref, i) => ({
      id: ref.id,
      uri: ref.uri,
      label: settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<string>).value : '',
    }));
  }

  // ===========================================================================
  // Internal: shared raw fetch + parsers
  // ===========================================================================

  /**
   * Fetches and caches the raw descriptor JSON-LD once. The three public
   * methods that need this resource (getDescriptor / getTreeNumbers /
   * getAllowedQualifiers) all share a single cached entry instead of
   * fetching three times on cold lookup.
   */
  private async fetchDescriptorRaw(meshId: string): Promise<MeSHDescriptorResponse | null> {
    const cacheKey = `mesh:raw:${meshId}`;
    return cache.getOrSet(
      CACHE_PREFIX.MESH,
      cacheKey,
      async () => {
        try {
          const response = await this.request<MeSHDescriptorResponse>(`/${meshId}.json`);
          return response ?? null;
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
   * Fetches a qualifier's label from its own JSON-LD resource. Cached
   * with STATIC TTL (24h) — qualifier labels are part of the controlled
   * vocabulary and almost never change between MeSH releases.
   */
  private async fetchQualifierLabel(qualifierId: string): Promise<string> {
    const cacheKey = `mesh:qlabel:${qualifierId}`;
    return cache.getOrSet(
      CACHE_PREFIX.MESH,
      cacheKey,
      async () => {
        try {
          const raw = await this.request<MeSHDescriptorResponse>(`/${qualifierId}.json`);
          const main = this.findMainEntity(raw, qualifierId);
          if (main && main['rdfs:label']) {
            return this.extractValue(main['rdfs:label']);
          }
        } catch {
          // swallow — caller defaults to '' on rejection
        }
        return '';
      },
      DEFAULT_TTL.STATIC,
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

    if (mainEntity['rdfs:label']) {
      descriptor.label = this.extractValue(mainEntity['rdfs:label']);
    }

    if (mainEntity['meshv:scopeNote']) {
      descriptor.scopeNote = this.extractValue(mainEntity['meshv:scopeNote']);
    }

    descriptor.treeNumbers = this.extractTreeNumbers(response);
    descriptor.concepts = this.extractConcepts(response);
    // For getDescriptor we expose qualifier URIs without labels (avoid
    // fanning out N extra requests on every descriptor read). Callers who
    // need labels use getAllowedQualifiers.
    descriptor.qualifiers = this.extractQualifierRefs(response).map((ref) => ({
      id: ref.id,
      uri: ref.uri,
      label: '',
    }));

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
   * Extracts concepts from response, resolving each concept's terms by
   * looking up meshv:Term entries that share the same @graph.
   */
  private extractConcepts(response: MeSHDescriptorResponse): MeSHConcept[] {
    const concepts: MeSHConcept[] = [];
    const graph = response['@graph'];

    if (!Array.isArray(graph)) {
      return concepts;
    }

    // First pass: build a URI → term-label map from meshv:Term entries.
    const termLabels = new Map<string, string>();
    for (const item of graph) {
      if (item['@type'] === 'meshv:Term' && item['@id'] && item['rdfs:label']) {
        termLabels.set(item['@id'] as string, this.extractValue(item['rdfs:label']));
      }
    }

    // Second pass: build concepts and resolve their term references.
    for (const item of graph) {
      if (item['@type'] === 'meshv:Concept' && item['rdfs:label']) {
        const concept: MeSHConcept = {
          uri: item['@id'] || '',
          label: this.extractValue(item['rdfs:label']),
          isPreferred: Boolean(item['meshv:preferredConcept']),
          terms: this.resolveTermRefs(item['meshv:term'], termLabels),
        };
        concepts.push(concept);
      }
    }

    return concepts;
  }

  /**
   * Given a meshv:term property value (URI string or array of URI refs)
   * and a URI → label map, returns the resolved term labels in order.
   * Unresolved references are skipped — they typically mean the term
   * lives on a separate document, which is rare for MeSH descriptors.
   */
  private resolveTermRefs(termProp: unknown, termLabels: Map<string, string>): string[] {
    if (!termProp) return [];
    const refs = Array.isArray(termProp) ? termProp : [termProp];
    const labels: string[] = [];
    for (const ref of refs) {
      const uri = typeof ref === 'string' ? ref : (ref as { '@id'?: string } | null)?.['@id'];
      if (uri && termLabels.has(uri)) {
        labels.push(termLabels.get(uri) as string);
      }
    }
    return labels;
  }

  /**
   * Extracts qualifier URI references from response (no labels — those
   * live on each qualifier's own resource and are fetched on demand by
   * getAllowedQualifiers).
   */
  private extractQualifierRefs(response: MeSHDescriptorResponse): Array<{ id: string; uri: string }> {
    const refs: Array<{ id: string; uri: string }> = [];
    const graph = response['@graph'];

    if (!Array.isArray(graph)) {
      return refs;
    }

    for (const item of graph) {
      if (item['meshv:allowableQualifier']) {
        const allowable = item['meshv:allowableQualifier'];
        const qualifierRefs = Array.isArray(allowable) ? allowable : [allowable];

        for (const ref of qualifierRefs) {
          const uri = typeof ref === 'string' ? ref : (ref as { '@id'?: string } | null)?.['@id'];
          if (uri) {
            refs.push({ id: this.extractMeshId(uri), uri });
          }
        }
      }
    }

    return refs;
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
    'meshv:term'?: unknown;
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
