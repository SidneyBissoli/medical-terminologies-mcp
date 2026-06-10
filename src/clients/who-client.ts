import { HttpClient, HttpError } from '../utils/http.js';
import { cache, CACHE_PREFIX, DEFAULT_TTL } from '../utils/cache.js';
import { withRetry } from '../utils/retry.js';
import { rateLimiters } from '../utils/rate-limiter.js';
import { ApiError, CachedToken, OAuthTokenResponse } from '../types/index.js';
import { extractErrorMessage } from '../utils/extract-error-message.js';
import { createClientLogger } from '../utils/logger.js';
import { getEnv } from '../utils/env.js';

const log = createClientLogger('who');

/**
 * WHO ICD-11 API Configuration
 *
 * `releaseId` is read from WHO_ICD11_RELEASE_ID at module load so operators
 * can pin to a specific release (e.g., '2024-01', '2025-01') without
 * waiting for a package update. WHO publishes a new release roughly
 * yearly; the default tracks the release this version of the package was
 * tested against.
 */
const WHO_CONFIG = {
  /** Base URL for ICD-11 API */
  apiBaseUrl: 'https://id.who.int/icd',
  /** OAuth2 token endpoint */
  tokenUrl: 'https://icdaccessmanagement.who.int/connect/token',
  /** OAuth2 scope */
  scope: 'icdapi_access',
  releaseId: process.env.WHO_ICD11_RELEASE_ID ?? '2024-01',
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
  private httpClient: HttpClient;

  /**
   * Creates a new WHO API client
   * @throws Error if credentials are not configured
   */
  constructor() {
    this.clientId = getEnv('WHO_CLIENT_ID') ?? '';
    this.clientSecret = getEnv('WHO_CLIENT_SECRET') ?? '';

    if (!this.clientId || !this.clientSecret) {
      throw new ApiError(
        'WHO API credentials not configured. Set WHO_CLIENT_ID and WHO_CLIENT_SECRET environment variables.',
        'AUTH_CONFIG_ERROR'
      );
    }

    this.httpClient = new HttpClient({
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
      log.debug('Using cached OAuth token');
      return cachedToken.accessToken;
    }

    // Request new token
    const tokenResponse = await withRetry(
      async () => {
        const response = await this.httpClient.post<OAuthTokenResponse>(
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
          log.warn({ attempt, error: error.message }, 'Token request retry');
        },
      }
    );

    // Honor the API's real expires_in with a 60s safety margin so we
    // refresh before the token actually expires. Floor at 60s in case the
    // server ever returns an absurdly short lifetime; fall back to
    // DEFAULT_TTL.TOKEN if expires_in is missing from the response.
    const expiresIn = tokenResponse.expires_in ?? DEFAULT_TTL.TOKEN;
    const ttlSeconds = Math.max(60, expiresIn - 60);
    const cachedTokenData: CachedToken = {
      accessToken: tokenResponse.access_token,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    cache.set(CACHE_PREFIX.TOKEN, TOKEN_CACHE_KEY, cachedTokenData, ttlSeconds);

    log.info('New OAuth token obtained and cached');
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

    log.debug({ url: fullUrl, params, language }, 'HTTP request');

    return withRetry(
      async () => {
        try {
          const startTime = Date.now();
          const response = await this.httpClient.get<T>(path, {
            params,
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept-Language': language,
            },
          });
          const duration = Date.now() - startTime;
          log.debug({ status: response.status, duration }, 'HTTP response OK');
          return response.data;
        } catch (error) {
          if (error instanceof HttpError) {
            const status = error.status;
            const responseData = error.data;
            const message = extractErrorMessage(error);

            log.error({ status, data: responseData }, 'HTTP error response');

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
    const cached = cache.get<ICD11SearchResponse>(CACHE_PREFIX.ICD11, cacheKey);
    
    if (cached) {
      log.debug({ cacheKey }, 'Cache hit');
      return cached;
    }

    log.debug({ cacheKey }, 'Cache miss');
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
      // The client baseURL already includes `/icd`; URIs from WHO start
      // with that prefix too, so strip it before building the request or
      // it hits a doubled `/icd/icd/...` path that 404s. (Same
      // mistake `getEntity` previously avoided; fixing it here too.)
      const url = new URL(codeOrUri);
      path = url.pathname.replace(/^\/icd/, '');
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

    // Extract path from full URI if needed
    let path: string;
    if (uri.startsWith('http')) {
      const url = new URL(uri);
      // Remove /icd prefix since baseURL already includes it
      path = url.pathname.replace(/^\/icd/, '');
    } else {
      path = uri;
    }

    return cache.getOrSet(
      CACHE_PREFIX.ICD11,
      cacheKey,
      () => this.request<ICD11EntityResponse>(path, {}, language),
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

    const settled = await Promise.allSettled(
      entity.parent.map((parentUri) => this.getEntity(parentUri, language)),
    );

    const parents: ICD11EntityResponse[] = [];
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        parents.push(result.value);
      } else {
        log.warn({ parentUri: entity.parent![i], error: String(result.reason) }, 'Failed to fetch parent');
      }
    });

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

    const settled = await Promise.allSettled(
      entity.child.map((childUri) => this.getEntity(childUri, language)),
    );

    const children: ICD11EntityResponse[] = [];
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        children.push(result.value);
      } else {
        log.warn({ childUri: entity.child![i], error: String(result.reason) }, 'Failed to fetch child');
      }
    });

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
  /** Whether it is a leaf node */
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