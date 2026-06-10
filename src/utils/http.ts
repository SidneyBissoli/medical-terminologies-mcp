/**
 * Minimal HTTP client over the native `fetch` API (Node >= 18 undici,
 * Cloudflare Workers). Replaces axios so the dependency tree carries no
 * third-party HTTP stack — see CHANGELOG (axios → fetch migration).
 *
 * Surface is deliberately small: GET/POST with baseURL joining, query
 * params, per-request header overrides, and a timeout via
 * AbortSignal.timeout. Non-2xx responses and network failures both
 * throw HttpError; callers branch on `error.status` being set (HTTP
 * error) or undefined (network/timeout, always retryable).
 */

/**
 * Error thrown for any failed HTTP exchange.
 *
 * - `status` set: the server responded with a non-2xx code; `data` holds
 *   the parsed response body (object when JSON, string otherwise).
 * - `status` undefined: the request never completed (DNS failure,
 *   connection refused/reset, timeout). The underlying cause's message is
 *   folded into `message` so retry heuristics that match on
 *   ECONNRESET/ETIMEDOUT/etc. keep working.
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
  /** Prefix for relative request paths. Absolute URLs bypass it. */
  baseURL?: string;
  /** Default request timeout in milliseconds (default: 30000). */
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
 * extractErrorMessage's preview/truncation path.
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
 * - AbortSignal.timeout → DOMException Timeout/AbortError
 * - undici network failure → TypeError('fetch failed') whose `cause`
 *   carries the real ECONNREFUSED/ENOTFOUND error (sometimes an
 *   AggregateError when multiple address families were tried)
 */
function describeFetchFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `timeout of ${timeoutMs}ms exceeded`;
  }
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
  return String(error);
}

export class HttpClient {
  private readonly config: HttpClientConfig;

  constructor(config: HttpClientConfig = {}) {
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
    const timeout = options.timeout ?? this.config.timeout ?? 30000;
    const headers = { ...this.config.headers, ...options.headers };

    let response: Response;
    try {
      response = await fetch(fullUrl, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      throw new HttpError(describeFetchFailure(error, timeout));
    }

    const data = await parseBody(response);

    if (!response.ok) {
      throw new HttpError(`Request failed with status code ${response.status}`, {
        status: response.status,
        data,
      });
    }

    return { data: data as T, status: response.status };
  }
}
