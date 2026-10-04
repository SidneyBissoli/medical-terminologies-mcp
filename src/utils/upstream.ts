/**
 * The trip to the upstream — timeout, retry, budget — and the COUNT that feeds
 * the `retrieval` block of the provenance contract v1.1.
 *
 * Until 1.14.0 the retry by HTTP status of this server was dead code: every
 * client caught `HttpError` and re-threw `ApiError` INSIDE the function that
 * `withRetry` repeated, so `isRetryableError` never saw a status — only the
 * network substrings (ECONNRESET, ECONNREFUSED…) matched, and a timeout
 * ("timeout of 30000ms exceeded") matched nothing. A 503 from RxNav, a 429
 * from the WHO or a 502 HTML page from a gateway failed on the first try.
 * Since 1.15.0 (2026-09-27) the trip is made by `@sbissoli/mcp-upstream`, the
 * portfolio's shared fetch: retry with backoff and `Retry-After`, timeout per
 * attempt, total budget per trip, and the count of trips, attempts and
 * anomalies that goes out in the provenance of every response. The package
 * CLASSIFIES; this module DECIDES.
 *
 * Numbers (`UPSTREAM_POLICY`) preserve the ceilings the clients already had —
 * they are this server's measured policy, and the origins answer in ~1 s
 * (curl, 2026-09-27, portfolio User-Agent): RxNav 0.5–1.2 s, RxClass 0.5 s,
 * MeSH 0.7–1.8 s (0.8 s of TCP on the first connection), ClinicalTables
 * 0.5–1.1 s, WHO token endpoint 1.5 s and ICD API 1.2–1.5 s just to refuse
 * without credentials (0.7 s of TCP — the WHO is the farthest origin).
 * Authenticated, measured at the production edge the same day (Worker →
 * WHO): `icd11_search` 4.6 s per search (5.7 s with the token dance),
 * `icd11_lookup` 1.0 s — the slowest trip this server makes, still six
 * times under the ceiling. No origin came near 30 s; the ceiling exists for
 * the hung connection, not to hurry the source.
 *  - 30 s per attempt for WHO/NLM/RxNorm/MeSH (60 s for SNOMED until it was
 *    retired in 2.0.0), 15 s for the WHO OAuth token — the same
 *    values each `HttpClient` carried before;
 *  - 2 retries (3 attempts) for what is transient, backoff 1 s → 2 s without
 *    jitter (the tests count the clock);
 *  - budget = ceiling + 6 s: room for three fast failures (503 in under 1 s,
 *    429) with both waits; NOT room for a second 30 s attempt after a first
 *    one that hung — and there should not be, the MCP client's patience is
 *    finite.
 *
 * What repeats and what does not (`retryUpstream`):
 *  - 5xx, 429 (honoring `Retry-After`) and network failure repeat — the
 *    package default; this is the retry that was dead;
 *  - **timeout does NOT repeat**: the attempt that hung already spent the
 *    whole ceiling (parity with ilo/uis; the old list repeated it in theory,
 *    never in practice);
 *  - 404 does not repeat (package default): every client maps it to
 *    `ApiError NOT_FOUND`, and sixteen readers treat that as legitimate
 *    absence — unchanged;
 *  - 401 does not repeat (4xx): the WHO client clears the cached token and
 *    throws `AUTH_EXPIRED`, as before;
 *  - `malformed_body` never happens here: the trip is made in `response`
 *    mode and `HttpClient.parseBody` keeps its lenient semantics (text that
 *    is not JSON becomes a string, an empty body becomes `undefined`) —
 *    `extractErrorMessage` previews HTML error pages from that string.
 *
 * ONE COLLECTOR PER SOURCE, not per call. Multi-source tools
 * (`find_equivalent`, `validate_codes`, `search`) emit one provenance block
 * per source — license segregation is a contract rule — and the `retrieval`
 * of the LOINC block must not inherit an anomaly of the WHO. So the
 * dispatcher (`handle` in src/register.ts) opens a MAP of collectors per
 * tool call, keyed by the source's cache prefix (`CACHE_PREFIX.*`, the same
 * key the fetch-meta collector uses), and each `HttpClient` records its
 * trips in the collector of ITS source. `medicalProvenance(key)` reads
 * `retrievalFor(src.cachePrefixes)`: the diagnostics of that origin in this
 * call — ATC shares RxNav with RxNorm and therefore shares its collector,
 * which is honest (same host, same trips). The WHO OAuth token has its own
 * key (`token`) that no preset lists: infrastructure never reaches a block,
 * consistent with `cacheMetaFor`.
 *
 * `retrieved_at`/`served_from_cache` keep coming from the fetch-meta
 * collector (the cache layer knows the ORIGINAL extraction instant of a
 * hit; this collector only sees the network). Outside a collector (direct
 * handler calls in tests) a trip gets a disposable one — the policy still
 * applies — and the block says `retrieval: null` ("not measured"), never
 * breaks. Rate limiters keep running BEFORE each trip, outside the package,
 * as before.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createUpstream,
  defaultRetryOn,
  type RetryContext,
  type Upstream,
  type UpstreamCall,
} from '@sbissoli/mcp-upstream';
import { RetrievalAnomalyKindSchema, type RetrievalInput } from '@sbissoli/mcp-provenance';
import { CACHE_PREFIX } from './cache.js';
import { SERVER_INFO } from '../server-core.js';

/** The origins this server talks to, keyed like the cache (`CACHE_PREFIX` values). */
export type UpstreamSource = (typeof CACHE_PREFIX)[keyof typeof CACHE_PREFIX];

/**
 * Identifiable User-Agent (portfolio policy: upstream sysadmins must be able
 * to reach the contact). Before 1.15.0 only the SNOMED client sent one.
 * Resolved lazily: `server-core` sits in an import cycle with the clients.
 */
export function userAgent(): string {
  return `${SERVER_INFO.name}/${SERVER_INFO.version} (https://medical.sidneybissoli.com; sbissoli76@gmail.com)`;
}

/** The network policy of the server (see the header: ceilings preserved, measured 2026-09-27). */
export const UPSTREAM_POLICY = {
  /** Ceiling of ONE attempt (headers + body) per origin, in ms. */
  timeoutMs: {
    [CACHE_PREFIX.ICD11]: 30_000,
    [CACHE_PREFIX.LOINC]: 30_000,
    [CACHE_PREFIX.RXNORM]: 30_000,
    [CACHE_PREFIX.MESH]: 30_000,
    [CACHE_PREFIX.TOKEN]: 15_000,
  } satisfies Record<UpstreamSource, number>,
  /** Retries beyond the first attempt (only for what is transient — see `retryUpstream`). */
  retries: 2,
  /** Waits between attempts: 1 s, then 2 s. */
  backoff: { baseMs: 1_000, maxMs: 4_000, jitterMs: 0 },
  /** TOTAL budget of a trip = the attempt ceiling + this slack (both waits + fast failures). */
  budgetSlackMs: 6_000,
} as const;

/**
 * I/O of the wait between attempts, in an object so tests can replace it
 * (`vi.spyOn(upstreamIo, 'sleep')`): a permanent 503 in a stub would cost
 * 3 s of real backoff per trip.
 */
export const upstreamIo = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The decision to repeat a failed attempt (the package says the class). */
export function retryUpstream(ctx: RetryContext): boolean {
  // The attempt that hung already spent the whole ceiling — nobody waits for that twice.
  if (ctx.kind === 'timeout') return false;
  return defaultRetryOn(ctx);
}

/**
 * The network policy of one origin in the package's shape, with LATE binding
 * to the global `fetch` — nock and the tests replace it after this module loads.
 */
export function upstreamMedical(source: UpstreamSource): Upstream {
  const timeoutMs = UPSTREAM_POLICY.timeoutMs[source];
  return createUpstream({
    userAgent: userAgent(),
    timeoutMs,
    retries: UPSTREAM_POLICY.retries,
    budgetMs: timeoutMs + UPSTREAM_POLICY.budgetSlackMs,
    backoff: UPSTREAM_POLICY.backoff,
    honorRetryAfter: true,
    retryOn: retryUpstream,
    sleep: (ms) => upstreamIo.sleep(ms),
    fetchImpl: (input, init) => globalThis.fetch(input, init),
  });
}

const collectorStorage = new AsyncLocalStorage<Map<string, UpstreamCall>>();

/**
 * Opens the collectors of ONE tool call (one per source, created on first
 * trip) and runs `fn` inside them — or reuses the open ones, if `fn` is a
 * step of a larger call (the outer tool must not lose the inner trips).
 */
export function withUpstreamCalls<T>(fn: () => Promise<T>): Promise<T> {
  return collectorStorage.getStore() ? fn() : collectorStorage.run(new Map(), fn);
}

/**
 * The collector of `source` in the current call; outside a call, a disposable
 * one (the trip still has the policy, the count is simply not read).
 */
export function upstreamCallFor(source: UpstreamSource): UpstreamCall {
  const store = collectorStorage.getStore();
  if (!store) return upstreamMedical(source).call();
  let call = store.get(source);
  if (!call) {
    call = upstreamMedical(source).call();
    store.set(source, call);
  }
  return call;
}

/**
 * The `retrieval` measured for the given sources in this call — summed when a
 * preset spans more than one collector; `null` outside a collector, for a
 * bundled dataset (no source) or when the response came entirely from cache
 * (no trip). Anomalies come out in the canonical order of the contract's
 * vocabulary, like the package does for one collector.
 */
export function retrievalFor(sources: readonly string[]): RetrievalInput | null {
  const store = collectorStorage.getStore();
  if (!store) return null;
  const parts = sources
    .map((s) => store.get(s)?.retrieval() ?? null)
    .filter((r): r is RetrievalInput => r !== null);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const counts = new Map<string, number>();
  for (const part of parts) {
    for (const a of part.anomalies ?? []) counts.set(a.kind, (counts.get(a.kind) ?? 0) + a.count);
  }
  return {
    requests: parts.reduce((n, p) => n + p.requests, 0),
    attempts: parts.reduce((n, p) => n + p.attempts, 0),
    anomalies: RetrievalAnomalyKindSchema.options
      .filter((kind) => counts.has(kind))
      .map((kind) => ({ kind, count: counts.get(kind)! })),
  };
}
