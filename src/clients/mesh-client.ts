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
   * Gets descriptor details by MeSH ID. Returns the descriptor's label,
   * scope note (sourced from the preferred concept), tree numbers, the
   * preferred concept (with its term labels resolved), and the list of
   * allowable qualifiers (with labels populated).
   *
   * This fans out across several MeSH endpoints in parallel; the NLM
   * Linked Data API exposes each resource separately (descriptor,
   * concept, term, tree number, qualifier) rather than bundling them
   * into a single document. The shared rxnorm/nlm rate limiter bounds
   * concurrency, and each sub-resource is cached separately so
   * subsequent calls in the same session avoid the fan-out cost.
   *
   * @param meshId - MeSH Descriptor ID (e.g., 'D006973')
   * @returns Descriptor details or null if not found
   */
  async getDescriptor(meshId: string): Promise<MeSHDescriptor | null> {
    const raw = await this.fetchDescriptorRaw(meshId);
    if (!raw) return null;

    const treeUris = toUriArray(raw.treeNumber);
    const qualifierUris = toUriArray(raw.allowableQualifier);
    const conceptUri = typeof raw.preferredConcept === 'string' ? raw.preferredConcept : '';

    const [treeNumbers, conceptResolved, qualifiers] = await Promise.all([
      this.resolveTreeNumbers(treeUris),
      conceptUri ? this.resolveConcept(conceptUri) : Promise.resolve(null),
      this.resolveQualifiers(qualifierUris),
    ]);

    return {
      id: meshId,
      uri: `${MESH_CONFIG.baseUrl}/${meshId}`,
      label: this.extractValue(raw.label),
      // Scope note lives on the preferred concept, not on the descriptor
      // itself. The descriptor's `annotation` field is an indexer note,
      // not a user-facing definition — using the concept's scopeNote is
      // semantically what tool consumers expect.
      scopeNote: conceptResolved?.scopeNote ?? '',
      treeNumbers,
      // The descriptor only directly references its preferred concept;
      // non-preferred concepts (when they exist) require a SPARQL query
      // beyond the scope of this REST client. Multi-concept descriptors
      // are uncommon — tool users get the preferred concept's label and
      // synonyms, which is the dominant use case.
      concepts: conceptResolved
        ? [
            {
              uri: conceptResolved.uri,
              label: conceptResolved.label,
              isPreferred: true,
              terms: conceptResolved.terms,
            },
          ]
        : [],
      qualifiers,
    };
  }

  /**
   * Gets tree numbers (with their labels resolved) for a descriptor.
   *
   * @param meshId - MeSH Descriptor ID
   * @returns Array of tree numbers
   */
  async getTreeNumbers(meshId: string): Promise<MeSHTreeNumber[]> {
    const raw = await this.fetchDescriptorRaw(meshId);
    if (!raw) return [];
    return this.resolveTreeNumbers(toUriArray(raw.treeNumber));
  }

  /**
   * Gets allowed qualifiers (with labels) for a descriptor. The
   * descriptor only references qualifiers by URI; this method fetches
   * each qualifier's label in parallel and caches them with STATIC TTL
   * since the controlled vocabulary almost never changes.
   *
   * @param meshId - MeSH Descriptor ID
   * @returns Array of allowed qualifiers with labels populated
   */
  async getAllowedQualifiers(meshId: string): Promise<MeSHQualifier[]> {
    const raw = await this.fetchDescriptorRaw(meshId);
    if (!raw) return [];
    return this.resolveQualifiers(toUriArray(raw.allowableQualifier));
  }

  // ===========================================================================
  // Internal: per-resource fetchers (each cached, each respects rate limiter)
  // ===========================================================================

  /**
   * Fetches and caches the raw descriptor JSON-LD once. Multiple public
   * methods (getDescriptor / getTreeNumbers / getAllowedQualifiers) all
   * share a single cached entry, so a tool sequence that calls all three
   * on the same descriptor only fetches once.
   *
   * The NLM endpoint returns compact JSON-LD: top-level fields named in
   * the response's `@context` (e.g., `label`, `treeNumber`,
   * `preferredConcept`, `allowableQualifier`), with no `@graph`. Earlier
   * versions of this client expected a `@graph` array; that shape is
   * gone.
   */
  private async fetchDescriptorRaw(meshId: string): Promise<MeSHDescriptorRaw | null> {
    const cacheKey = `mesh:raw:${meshId}`;
    return cache.getOrSet(
      CACHE_PREFIX.MESH,
      cacheKey,
      async () => {
        try {
          const response = await this.request<MeSHDescriptorRaw>(`/${meshId}.json`);
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
   * Fetches and caches a concept resource (M-prefixed). The concept
   * holds the user-facing scope note (the descriptor's own `annotation`
   * field is an indexer note, not a definition) plus the references to
   * its terms — non-preferred terms via `term` (URI scalar or array)
   * and the preferred term via `preferredTerm` (single URI).
   */
  private async fetchConceptRaw(uri: string): Promise<MeSHConceptRaw | null> {
    const cacheKey = `mesh:concept:${uri}`;
    return cache.getOrSet(
      CACHE_PREFIX.MESH,
      cacheKey,
      async () => {
        try {
          const path = uriToPath(uri);
          if (!path) return null;
          return await this.request<MeSHConceptRaw>(path);
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
   * Fetches a term resource and returns its prefLabel. STATIC TTL
   * because terms almost never change once minted.
   */
  private async fetchTermLabel(uri: string): Promise<string> {
    const cacheKey = `mesh:term:label:${uri}`;
    return cache.getOrSet(
      CACHE_PREFIX.MESH,
      cacheKey,
      async () => {
        try {
          const path = uriToPath(uri);
          if (!path) return '';
          const raw = await this.request<MeSHTermRaw>(path);
          return this.extractValue(raw?.prefLabel) || this.extractValue(raw?.label);
        } catch {
          return '';
        }
      },
      DEFAULT_TTL.STATIC,
    );
  }

  /**
   * Fetches a tree number resource. The "label" of a tree number IS the
   * tree number string itself (e.g., `C14.907.489`) — that's the format
   * downstream tools want to display. STATIC TTL.
   */
  private async fetchTreeNumberLabel(uri: string): Promise<string> {
    const cacheKey = `mesh:tree:label:${uri}`;
    return cache.getOrSet(
      CACHE_PREFIX.MESH,
      cacheKey,
      async () => {
        try {
          const path = uriToPath(uri);
          if (!path) return '';
          const raw = await this.request<MeSHTreeNumberRaw>(path);
          return this.extractValue(raw?.label);
        } catch {
          return '';
        }
      },
      DEFAULT_TTL.STATIC,
    );
  }

  /**
   * Fetches a qualifier's label. STATIC TTL — qualifiers are part of
   * the controlled vocabulary and almost never change between MeSH
   * releases.
   */
  private async fetchQualifierLabel(qualifierId: string): Promise<string> {
    const cacheKey = `mesh:qlabel:${qualifierId}`;
    return cache.getOrSet(
      CACHE_PREFIX.MESH,
      cacheKey,
      async () => {
        try {
          const raw = await this.request<MeSHQualifierRaw>(`/${qualifierId}.json`);
          return this.extractValue(raw?.label);
        } catch {
          return '';
        }
      },
      DEFAULT_TTL.STATIC,
    );
  }

  // ===========================================================================
  // Internal: resolvers (fan-out across multiple sub-resources in parallel)
  // ===========================================================================

  /**
   * Given an array of tree-number URIs, fetches each in parallel and
   * returns them with their labels (the tree-number strings) populated.
   */
  private async resolveTreeNumbers(uris: string[]): Promise<MeSHTreeNumber[]> {
    if (uris.length === 0) return [];
    const labels = await Promise.all(uris.map((u) => this.fetchTreeNumberLabel(u)));
    return uris.map((uri, i) => ({ uri, treeNumber: labels[i] }));
  }

  /**
   * Given a concept URI, fetches the concept and resolves all its term
   * labels (preferred + non-preferred) in parallel. Returns the concept
   * with terms as an array of plain strings (synonyms), matching the
   * shape the public MeSHConcept type expects.
   */
  private async resolveConcept(
    uri: string,
  ): Promise<{ uri: string; label: string; scopeNote: string; terms: string[] } | null> {
    const concept = await this.fetchConceptRaw(uri);
    if (!concept) return null;

    const termUris: string[] = [];
    if (typeof concept.preferredTerm === 'string') termUris.push(concept.preferredTerm);
    for (const t of toUriArray(concept.term)) termUris.push(t);

    const terms = (await Promise.all(termUris.map((t) => this.fetchTermLabel(t)))).filter(
      (t) => t.length > 0,
    );

    return {
      uri,
      label: this.extractValue(concept.label),
      scopeNote: this.extractValue(concept.scopeNote),
      terms,
    };
  }

  /**
   * Given an array of qualifier URIs, fetches each label in parallel.
   */
  private async resolveQualifiers(uris: string[]): Promise<MeSHQualifier[]> {
    if (uris.length === 0) return [];
    const ids = uris.map((u) => this.extractMeshId(u));
    const settled = await Promise.allSettled(ids.map((id) => this.fetchQualifierLabel(id)));
    return uris.map((uri, i) => ({
      id: ids[i],
      uri,
      label: settled[i].status === 'fulfilled' ? settled[i].value : '',
    }));
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Extracts MeSH ID from URI. Matches the trailing letter+digits stem
   * (e.g., D006973, M0010859, Q000503, T020937). Returns the input
   * unchanged when the URI doesn't end in that shape (e.g., tree
   * numbers like "C14.907.489" — those don't get an ID extracted; the
   * full URI is used as the cache key).
   */
  private extractMeshId(uri: string): string {
    const match = uri.match(/mesh\/([A-Z]\d+)$/);
    return match ? match[1] : uri;
  }

  /**
   * Extracts string value from a JSON-LD property whose value can be a
   * plain string, a `{ "@value": ..., "@language": ... }` object, or an
   * array of either. Returns empty string for anything else.
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
}

/**
 * Normalizes a JSON-LD field that can be a single URI string, an array
 * of URI strings, or absent into a flat string array. Items that aren't
 * strings are dropped.
 */
function toUriArray(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

/**
 * Converts an absolute MeSH URI to the relative path the client uses
 * (paths are relative to the axios baseURL `https://id.nlm.nih.gov/mesh`).
 * Appends `.json` if not already present, since the unsuffixed URLs
 * 302-redirect to N-triples.
 */
function uriToPath(uri: string): string {
  if (!uri) return '';
  const stripped = uri.replace(/^https?:\/\/id\.nlm\.nih\.gov\/mesh/, '');
  if (!stripped) return '';
  return stripped.endsWith('.json') ? stripped : `${stripped}.json`;
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

/**
 * Compact JSON-LD descriptor response (the `@context` maps the keys
 * below to vocab URIs; consumers don't need to look at the context
 * because the keys they want are already named in the response).
 */
interface MeSHDescriptorRaw {
  '@id'?: string;
  '@type'?: string;
  label?: unknown;
  // String URI when the descriptor has a single tree number, array of
  // URI strings when it has multiple. Absent on non-topical descriptors.
  treeNumber?: unknown;
  // Single URI; the descriptor's preferred concept resource.
  preferredConcept?: unknown;
  // Single URI; the descriptor's preferred term.
  preferredTerm?: unknown;
  // Array of URIs; the qualifiers permitted to combine with this descriptor.
  allowableQualifier?: unknown;
  // Indexer note. NOT the user-facing scope note (that lives on the
  // preferred concept).
  annotation?: unknown;
}

interface MeSHConceptRaw {
  '@id'?: string;
  '@type'?: string;
  label?: unknown;
  scopeNote?: unknown;
  preferredTerm?: unknown;
  // Non-preferred terms; URI scalar or array.
  term?: unknown;
}

interface MeSHTermRaw {
  '@id'?: string;
  '@type'?: string;
  prefLabel?: unknown;
  label?: unknown;
}

interface MeSHTreeNumberRaw {
  '@id'?: string;
  '@type'?: string;
  // For tree-number resources, `label` holds the tree-number string
  // itself (e.g., "C14.907.489").
  label?: unknown;
}

interface MeSHQualifierRaw {
  '@id'?: string;
  '@type'?: string;
  label?: unknown;
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
