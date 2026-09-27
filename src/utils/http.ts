/**
 * Minimal HTTP client over the portfolio's shared fetch
 * (`@sbissoli/mcp-upstream`, since 1.15.0; native `fetch` before that —
 * axios before 1.4.0). No third-party HTTP stack in the dependency tree.
 *
 * Surface is deliberately small: GET/POST with baseURL joining, query
 * params, per-request header overrides, and a timeout per attempt. The
 * trip itself — retry with backoff, `Retry-After`, budget, and the count
 * that feeds the provenance `retrieval` block — is the package's, under
 * this server's policy (`src/utils/upstream.ts`): every client names its
 * `source`, and its trips land in the collector of that source for the
 * current tool call. Non-2xx responses and network failures both throw
 * HttpError; callers branch on `error.status` being set (HTTP error) or
 * undefined (network/timeout).
 */

import { UpstreamError } from '@sbissoli/mcp-upstream';
import { upstreamCallFor, type UpstreamSource, UPSTREAM_POLICY } from './upstream.js';

/**
 * Error thrown for any failed HTTP exchange.
 *
 * - `status` set: the server responded with a non-2xx code — after the
 *   retries the policy allows, for a 5xx/429; `data` holds the parsed
 *   response body (object when JSON, string otherwise).
 * - `status` undefined: the request never completed (DNS failure,
 *   connection refused/reset, timeout). The underlying cause's message is
 *   folded into `message`; a timeout reads "timeout of <ms>ms exceeded"
 *   (`tools/crosswalk.ts` and `classifyError` read the word "timeout").
 *   When more than one attempt was made, the message ends with
 *   "(after N attempts)".
 */
export class HttpError extends Error {
  readonly status?: number;
  readonly data?: unknown;

  constructor(message: string, opts: { status?: number; data?: unknown } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = opts.status;
    this.data = opts.data;
  }
}

export interface HttpClientConfig {
  /**
   * The origin this client talks to, keyed like the cache: its trips are
   * counted in the collector of this source (`retrieval` of the block that
   * cites it) and get the attempt ceiling of `UPSTREAM_POLICY.timeoutMs`.
   */
  source: UpstreamSource;
  /** Prefix for relative request paths. Absolute URLs bypass it. */
  baseURL?: string;
  /** Ceiling of one attempt in ms (default: the policy's, per source). */
  timeout?: number;
  /** Headers sent on every request; per-request headers override them. */
  headers?: Record<string, string>;
}

export interface HttpRequestOptions {
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  timeout?: number;
}

interface HttpResponse<T> {
  data: T;
  status: number;
}

/**
 * Mirrors axios's lenient body handling: always attempt JSON.parse and
 * fall back to the raw string, because some upstreams (and nock fixtures)
 * serve JSON without an application/json content-type, while error pages
 * (Cloudflare challenges, nginx 502 HTML) need to surface as strings for
 * extractErrorMessage's preview/truncation path. This is why the trip is
 * made in the package's `response` mode: the body is ours to read.
 */
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Unwraps fetch's rejection shapes into a flat message:
 * - undici network failure → TypeError('fetch failed') whose `cause`
 *   carries the real ECONNREFUSED/ENOTFOUND error (sometimes an
 *   AggregateError when multiple address families were tried)
 * - anything else → its message
 */
function describeFetchFailure(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof AggregateError && cause.errors.length > 0) {
      const first = cause.errors[0];
      return first instanceof Error ? first.message : String(first);
    }
    if (cause instanceof Error) {
      return cause.message;
    }
    return error.message;
  }
  return error === undefined ? 'fetch failed' : String(error);
}

/**
 * From the package's error (class + count) to the error the rest of the
 * server reads (`HttpError`, by `instanceof` in the five clients). A
 * response that arrived keeps its status and parsed body, so the 404 →
 * `ApiError NOT_FOUND` mapping and `extractErrorMessage` are untouched.
 */
export async function translateUpstreamError(error: unknown, timeoutMs: number): Promise<unknown> {
  if (!(error instanceof UpstreamError)) return error;
  const after = error.attempts > 1 ? ` (after ${error.attempts} attempts)` : '';
  switch (error.kind) {
    case 'timeout':
      return new HttpError(`timeout of ${timeoutMs}ms exceeded${after}`);
    case 'network':
      return new HttpError(`${describeFetchFailure(error.cause)}${after}`);
    case 'aborted':
      return new HttpError(`request aborted${after}`);
    case 'malformed_body':
      // Not reachable in `response` mode (the body is parsed here, leniently).
      return new HttpError(`malformed upstream response${after}`, { status: error.status });
    default: {
      // A response arrived: http_4xx, http_5xx, rate_limited, not_found.
      const status = error.status ?? error.response?.status;
      const data = error.response ? await parseBody(error.response) : error.body;
      return new HttpError(`Request failed with status code ${status}${after}`, { status, data });
    }
  }
}

export class HttpClient {
  private readonly config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.config = config;
  }

  async get<T>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.request<T>('GET', url, undefined, options);
  }

  async post<T>(
    url: string,
    body: URLSearchParams | string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    return this.request<T>('POST', url, body, options);
  }

  private buildUrl(url: string, params?: HttpRequestOptions['params']): string {
    const absolute = /^https?:\/\//i.test(url) ? url : `${this.config.baseURL ?? ''}${url}`;
    if (!params || Object.keys(params).length === 0) {
      return absolute;
    }
    const parsed = new URL(absolute);
    for (const [key, value] of Object.entries(params)) {
      parsed.searchParams.append(key, String(value));
    }
    return parsed.toString();
  }

  private async request<T>(
    method: string,
    url: string,
    body: URLSearchParams | string | undefined,
    options: HttpRequestOptions,
  ): Promise<HttpResponse<T>> {
    const fullUrl = this.buildUrl(url, options.params);
    const timeout =
      options.timeout ?? this.config.timeout ?? UPSTREAM_POLICY.timeoutMs[this.config.source];
    const headers = { ...this.config.headers, ...options.headers };

    let response: Response;
    try {
      response = await upstreamCallFor(this.config.source).response(fullUrl, {
        method,
        headers,
        body,
        timeoutMs: timeout,
      });
    } catch (error) {
      throw await translateUpstreamError(error, timeout);
    }

    // Only 2xx reaches here: the package throws on every other status.
    return { data: (await parseBody(response)) as T, status: response.status };
  }
}
