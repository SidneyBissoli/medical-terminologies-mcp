import axios, { AxiosInstance, AxiosError } from 'axios';
import { cache, CACHE_PREFIX, DEFAULT_TTL } from '../utils/cache.js';
import { withRetry } from '../utils/retry.js';
import { rateLimiters } from '../utils/rate-limiter.js';
import { ApiError, CachedToken, OAuthTokenResponse } from '../types/index.js';

/**
 * WHO ICD-11 API Configuration
 */
const WHO_CONFIG = {
  /** Base URL for ICD-11 API */
  apiBaseUrl: 'https://id.who.int/icd',
  /** OAuth2 token endpoint */
  tokenUrl: 'https://icdaccessmanagement.who.int/connect/token',
  /** OAuth2 scope */
  scope: 'icdapi_access',
  /** Release ID (use 2024-01 for latest stable release) */
  releaseId: '2024-01',
  /** Linearization for MMS (Mortality and Morbidity Statistics) */
  linearization: 'mms',
} as const;

/**
 * Cache key for OAuth token
 */
const TOKEN_CACHE_KEY = 'who_oauth_token';

/**
 * WHO ICD-11 API Client with OAuth2 authentication
 *
 * Handles:
 * - OAuth2 client credentials flow
 * - Automatic token refresh before expiry
 * - Rate limiting (5 requests/second)
 * - Retry with exponential backoff
 * - Response caching
 */
export class WHOClient {
  private clientId: string;
  private clientSecret: string;
  private httpClient: AxiosInstance;

  /**
   * Creates a new WHO API client
   * @throws Error if credentials are not configured
   */
  constructor() {
    this.clientId = process.env.WHO_CLIENT_ID ?? '';
    this.clientSecret = process.env.WHO_CLIENT_SECRET ?? '';

    if (!this.clientId || !this.clientSecret) {
      throw new ApiError(
        'WHO API credentials not configured. Set WHO_CLIENT_ID and WHO_CLIENT_SECRET environment variables.',
        'AUTH_CONFIG_ERROR'
      );
    }

    this.httpClient = axios.create({
      baseURL: WHO_CONFIG.apiBaseUrl,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'API-Version': 'v2',
      },
    });
  }

  /**
   * Obtains an OAuth2 access token using client credentials flow
   * Caches the token for reuse (50 min TTL, tokens expire in 60 min)
   *
   * @returns Access token string
   * @throws ApiError if token request fails
   */
  private async getAccessToken(): Promise<string> {
    // Check cache first
    const cachedToken = cache.get<CachedToken>(CACHE_PREFIX.TOKEN, TOKEN_CACHE_KEY);
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
      return cachedToken.accessToken;
    }

    // Request new token
    const tokenResponse = await withRetry(
      async () => {
        const response = await axios.post<OAuthTokenResponse>(
          WHO_CONFIG.tokenUrl,
          new URLSearchParams({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'client_credentials',
            scope: WHO_CONFIG.scope,
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 15000,
          }
        );
        return response.data;
      },
      {
        maxRetries: 3,
        initialDelay: 2000,
        onRetry: (attempt, error) => {
          process.stderr.write(`[who-client] Token request retry ${attempt}: ${error.message}\n`);
        },
      }
    );

    // Cache the token (50 min TTL to refresh before 60 min expiry)
    const cachedTokenData: CachedToken = {
      accessToken: tokenResponse.access_token,
      expiresAt: Date.now() + DEFAULT_TTL.TOKEN * 1000,
    };
    cache.set(CACHE_PREFIX.TOKEN, TOKEN_CACHE_KEY, cachedTokenData, DEFAULT_TTL.TOKEN);

    process.stderr.write('[who-client] New OAuth token obtained and cached\n');
    return tokenResponse.access_token;
  }

  /**
   * Makes an authenticated request to the WHO ICD-11 API
   *
   * @param path - API path (without base URL)
   * @param params - Query parameters
   * @param language - Language code (default: 'en')
   * @returns API response data
   * @throws ApiError on request failure
   */
  async request<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
    language: string = 'en'
  ): Promise<T> {
    // Apply rate limiting
    await rateLimiters.who.acquire();

    const token = await this.getAccessToken();

    // Build full URL for debugging
    const fullUrl = `${WHO_CONFIG.apiBaseUrl}${path}`;
    const requestHeaders = {
      'Authorization': `Bearer ${token.substring(0, 20)}...`,
      'Accept-Language': language,
      'Accept': 'application/json',
      'API-Version': 'v2',
    };

    process.stderr.write(`[who-client] DEBUG Request:\n`);
    process.stderr.write(`  URL: ${fullUrl}\n`);
    process.stderr.write(`  Headers: ${JSON.stringify(requestHeaders, null, 2)}\n`);
    process.stderr.write(`  Params: ${JSON.stringify(params)}\n`);

    return withRetry(
      async () => {
        try {
          const response = await this.httpClient.get<T>(path, {
            params,
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept-Language': language,
            },
          });
          process.stderr.write(`[who-client] DEBUG Response: OK (${response.status})\n`);
          return response.data;
        } catch (error) {
          if (error instanceof AxiosError) {
            const status = error.response?.status;
            const responseData = error.response?.data;
            const message = responseData?.message || error.message;

            process.stderr.write(`[who-client] DEBUG Error Response:\n`);
            process.stderr.write(`  Status: ${status}\n`);
            process.stderr.write(`  Data: ${JSON.stringify(responseData, null, 2)}\n`);
            process.stderr.write(`  Headers: ${JSON.stringify(error.response?.headers, null, 2)}\n`);

            // Handle specific error codes
            if (status === 401) {
              // Token expired, clear cache and retry
              cache.delete(CACHE_PREFIX.TOKEN, TOKEN_CACHE_KEY);
              throw new ApiError('Authentication failed - token expired', 'AUTH_EXPIRED', status);
            }
            if (status === 404) {
              throw new ApiError(`Resource not found: ${path}`, 'NOT_FOUND', status);
            }
            if (status === 429) {
              throw new ApiError('Rate limit exceeded', 'RATE_LIMIT', status);
            }

            throw new ApiError(
              `WHO API error: ${message}`,
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

  /**
   * Searches for ICD-11 entities by text query
   *
   * @param query - Search text
   * @param language - Language code
   * @param maxResults - Maximum results to return (1-100)
   * @returns Search results with matching entities
   */
  async search(
    query: string,
    language: string = 'en',
    maxResults: number = 25
  ): Promise<ICD11SearchResponse> {
    const cacheKey = `search:${query}:${language}:${maxResults}`;

    return cache.getOrSet(
      CACHE_PREFIX.ICD11,
      cacheKey,
      () => this.request<ICD11SearchResponse>(
        `/release/11/${WHO_CONFIG.releaseId}/${WHO_CONFIG.linearization}/search`,
        {
          q: query,
          subtreeFilterUsesFoundationDescendants: false,
          includeKeywordResult: true,
          useFlexisearch: true,
          flatResults: true,
          highlightingEnabled: false,
          medicalCodingMode: true,
        },
        language
      ),
      DEFAULT_TTL.SEARCH
    );
  }

  /**
   * Retrieves details for a specific ICD-11 entity by code or URI
   *
   * @param codeOrUri - ICD-11 code (e.g., "BA00") or full URI
   * @param language - Language code
   * @returns Entity details
   */
  async lookup(codeOrUri: string, language: string = 'en'): Promise<ICD11EntityResponse> {
    const cacheKey = `lookup:${codeOrUri}:${language}`;

    // Determine if it's a code or URI
    let path: string;
    if (codeOrUri.startsWith('http')) {
      // Extract path from full URI
      const url = new URL(codeOrUri);
      path = url.pathname;
    } else {
      // Build path from code
      path = `/release/11/${WHO_CONFIG.releaseId}/${WHO_CONFIG.linearization}/codeinfo/${codeOrUri}`;
    }

    return cache.getOrSet(
      CACHE_PREFIX.ICD11,
      cacheKey,
      () => this.request<ICD11EntityResponse>(path, {}, language),
      DEFAULT_TTL.LOOKUP
    );
  }

  /**
   * Retrieves entity details by foundation URI
   *
   * @param uri - Foundation entity URI
   * @param language - Language code
   * @returns Entity details
   */
  async getEntity(uri: string, language: string = 'en'): Promise<ICD11EntityResponse> {
    const cacheKey = `entity:${uri}:${language}`;

    return cache.getOrSet(
      CACHE_PREFIX.ICD11,
      cacheKey,
      () => this.request<ICD11EntityResponse>(uri, {}, language),
      DEFAULT_TTL.LOOKUP
    );
  }

  /**
   * Retrieves parent entities (ancestors) for a code
   *
   * @param code - ICD-11 code
   * @param language - Language code
   * @returns Array of parent entities
   */
  async getParents(code: string, language: string = 'en'): Promise<ICD11EntityResponse[]> {
    const entity = await this.lookup(code, language);

    if (!entity.parent || entity.parent.length === 0) {
      return [];
    }

    const parents: ICD11EntityResponse[] = [];
    for (const parentUri of entity.parent) {
      try {
        const parent = await this.getEntity(parentUri, language);
        parents.push(parent);
      } catch (error) {
        process.stderr.write(`[who-client] Failed to fetch parent ${parentUri}: ${error}\n`);
      }
    }

    return parents;
  }

  /**
   * Retrieves child entities (descendants) for a code
   *
   * @param code - ICD-11 code
   * @param language - Language code
   * @returns Array of child entities
   */
  async getChildren(code: string, language: string = 'en'): Promise<ICD11EntityResponse[]> {
    const entity = await this.lookup(code, language);

    if (!entity.child || entity.child.length === 0) {
      return [];
    }

    const children: ICD11EntityResponse[] = [];
    for (const childUri of entity.child) {
      try {
        const child = await this.getEntity(childUri, language);
        children.push(child);
      } catch (error) {
        process.stderr.write(`[who-client] Failed to fetch child ${childUri}: ${error}\n`);
      }
    }

    return children;
  }

  /**
   * Retrieves all ICD-11 chapters
   *
   * @param language - Language code
   * @returns Array of chapter entities
   */
  async getChapters(language: string = 'en'): Promise<ICD11ChapterResponse> {
    const cacheKey = `chapters:${language}`;

    return cache.getOrSet(
      CACHE_PREFIX.ICD11,
      cacheKey,
      () => this.request<ICD11ChapterResponse>(
        `/release/11/${WHO_CONFIG.releaseId}/${WHO_CONFIG.linearization}`,
        {},
        language
      ),
      DEFAULT_TTL.STATIC
    );
  }

  /**
   * Retrieves postcoordination information for a code
   *
   * @param code - ICD-11 code
   * @param language - Language code
   * @returns Postcoordination axes and scales
   */
  async getPostcoordination(code: string, language: string = 'en'): Promise<ICD11PostcoordinationResponse> {
    const cacheKey = `postcoord:${code}:${language}`;

    return cache.getOrSet(
      CACHE_PREFIX.ICD11,
      cacheKey,
      () => this.request<ICD11PostcoordinationResponse>(
        `/release/11/${WHO_CONFIG.releaseId}/${WHO_CONFIG.linearization}/codeinfo/${code}/postcoordination`,
        {},
        language
      ),
      DEFAULT_TTL.LOOKUP
    );
  }
}

// ============================================================================
// Response Types (specific to WHO API responses)
// ============================================================================

/**
 * ICD-11 search response from WHO API
 */
export interface ICD11SearchResponse {
  /** Indicates if the search was successful */
  error: boolean;
  /** Error message if any */
  errorMessage?: string;
  /** Number of results found */
  resultChopped: boolean;
  /** Words used in the search */
  words: string[];
  /** Matching destination entities */
  destinationEntities: ICD11DestinationEntity[];
}

/**
 * Entity in search results
 */
export interface ICD11DestinationEntity {
  /** Entity ID (foundation URI) */
  id: string;
  /** ICD-11 code */
  theCode?: string;
  /** Entity title */
  title: string;
  /** Stem entity URI */
  stemId?: string;
  /** Whether it's a leaf node */
  isLeaf: boolean;
  /** Postcoordination availability */
  postcoordinationAvailability: string;
  /** Has coding note */
  hasCodingNote: boolean;
  /** Matching words/phrases */
  matchingPVs: MatchingPV[];
  /** Relevance score */
  score: number;
  /** Title matching score */
  titleScore?: number;
  /** Important flag */
  important?: boolean;
}

/**
 * Matching property value in search
 */
export interface MatchingPV {
  /** Property name */
  propertyId: string;
  /** Label */
  label: string;
  /** Relevance score */
  score: number;
  /** Whether important */
  important?: boolean;
}

/**
 * ICD-11 entity details response
 */
export interface ICD11EntityResponse {
  /** Context */
  '@context': string;
  /** Entity ID */
  '@id': string;
  /** Parent URIs */
  parent?: string[];
  /** Child URIs */
  child?: string[];
  /** Browser URL */
  browserUrl?: string;
  /** ICD-11 code */
  code?: string;
  /** Code range (for blocks) */
  codeRange?: string;
  /** Class kind */
  classKind?: string;
  /** Block ID */
  blockId?: string;
  /** Title */
  title?: {
    '@language': string;
    '@value': string;
  };
  /** Definition */
  definition?: {
    '@language': string;
    '@value': string;
  };
  /** Long definition */
  longDefinition?: {
    '@language': string;
    '@value': string;
  };
  /** Fully specified name */
  fullySpecifiedName?: {
    '@language': string;
    '@value': string;
  };
  /** Diagnostic criteria */
  diagnosticCriteria?: {
    '@language': string;
    '@value': string;
  };
  /** Coding note */
  codingNote?: {
    '@language': string;
    '@value': string;
  };
  /** Exclusions */
  exclusion?: Array<{
    '@id': string;
    label?: { '@language': string; '@value': string };
  }>;
  /** Inclusions */
  inclusion?: Array<{
    '@id': string;
    label?: { '@language': string; '@value': string };
  }>;
  /** Index terms */
  indexTerm?: Array<{
    '@id': string;
    label?: { '@language': string; '@value': string };
  }>;
  /** Postcoordination scales */
  postcoordinationScale?: Array<{
    axisName: string;
    requiredPostcoordination: boolean;
    allowMultipleValues: string;
    scaleEntity: string[];
  }>;
  /** Foundation child count */
  foundationChildElsewhere?: Array<{
    '@id': string;
    label?: { '@language': string; '@value': string };
    linearizationReference?: string;
  }>;
}

/**
 * ICD-11 chapters response
 */
export interface ICD11ChapterResponse {
  '@context': string;
  '@id': string;
  title?: {
    '@language': string;
    '@value': string;
  };
  child?: string[];
}

/**
 * ICD-11 postcoordination response
 */
export interface ICD11PostcoordinationResponse {
  '@context': string;
  '@id': string;
  postcoordinationScale?: Array<{
    axisName: string;
    requiredPostcoordination: boolean;
    allowMultipleValues: string;
    scaleEntity: string[];
  }>;
}

/** Singleton client instance */
let whoClientInstance: WHOClient | null = null;

/**
 * Gets or creates the WHO API client singleton
 * @returns WHO API client instance
 */
export function getWHOClient(): WHOClient {
  if (!whoClientInstance) {
    whoClientInstance = new WHOClient();
  }
  return whoClientInstance;
}
