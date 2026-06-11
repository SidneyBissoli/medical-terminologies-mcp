/**
 * Cloudflare Workers entrypoint — Streamable HTTP transport via web-standard
 * Request/Response. Shares the createServer() / toolRegistry / tools / clients
 * code with the Node entrypoint (src/index.ts); only the transport layer and
 * the host glue differ.
 *
 * Build:  npm run build:worker
 * Dev:    npx wrangler dev
 * Deploy: handled by .github/workflows/deploy-worker.yml on tag push.
 *
 * Stage 1 note: per-isolate `node-cache` and in-memory token-bucket rate
 * limiter are reused as-is. For low traffic that's correct; under sustained
 * load (>100 req/s with multiple active isolates) the WHO/NLM upstream
 * quotas can be exceeded because each isolate enforces them independently.
 * Stage 2 (PROGRESS.md Phase 11.9 follow-up) swaps in a KV-backed cache
 * and a Durable Object rate limiter.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
// IMPORTANT: import from server-core.js, NOT server.js — the latter pulls
// in node:http and @hono/node-server which don't exist in Workers.
import { createServer, SERVER_INFO, toolRegistry } from './server-core.js';
import { setStatsRecorder, type StatsRecorder, type StatsPayload } from './utils/stats.js';

// Re-export the Durable Object class so wrangler can instantiate it.
// (The class lives under src/durable-objects/ to keep the worker.ts entry
// focused on routing; the runtime needs a top-level export to bind to.)
export { StatsCounter } from './durable-objects/stats-counter.js';

// Tool side-effect imports — each module registers its tools at load time.
// Same set as src/index.ts; the meta-test in src/index.test.ts pins that
// list for the stdio entry, and we mirror it here intentionally.
import './tools/icd11.js';
import './tools/loinc.js';
import './tools/rxnorm.js';
import './tools/mesh.js';
import './tools/snomed.js';
import './tools/crosswalk.js';
import './tools/atc.js';
import './tools/cid10.js';
import './tools/versioning.js';

// Prompts — orchestration templates exposed to MCP clients
import './prompts/index.js';

// Resources — static reference content exposed by URI
import './resources/index.js';
// Stats counter resource — DO-backed on Workers (see installStatsRecorder below)
import './resources/stats.js';

// Per-isolate startup timestamp for the /health uptime field. Set lazily
// on the first request, NOT at module init — Cloudflare Workers' Date.now()
// at module-load time can return 0 (no I/O has happened yet, so the system
// clock isn't exposed). Setting it on first request also gives a more
// useful semantic: "time since this isolate first served a request", which
// is what an operator actually wants from /health.
let isolateStartMs: number | null = null;


/**
 * Worker environment bindings — secrets set via `wrangler secret put` and
 * vars from wrangler.toml `[vars]` all land here. The platform-agnostic
 * clients (who-client.ts, etc.) read `process.env.X`, which Cloudflare's
 * nodejs_compat is supposed to populate from these bindings — except in
 * practice we observed it does NOT bridge secrets reliably (verified
 * 2026-05-10 with WHO_CLIENT_ID set in dashboard but undefined at runtime).
 * We bridge them explicitly below on first request.
 */
/**
 * Minimal types for the platform bindings we touch. The full
 * `@cloudflare/workers-types` package gives proper types but adds 100s of
 * KB to the build for a few interfaces we use shallowly. These local
 * shapes match the runtime contract and keep the typecheck honest.
 */
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
interface DurableObjectId {}
interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerEnv {
  WHO_CLIENT_ID?: string;
  WHO_CLIENT_SECRET?: string;
  WHO_ICD11_RELEASE_ID?: string;
  ENABLE_SNOMED_TOOLS?: string;
  SNOMED_BASE_URL?: string;
  SNOMED_LANGUAGE?: string;
  LOG_LEVEL?: string;
  STATS?: DurableObjectNamespace;
}

let envBridged = false;

/**
 * Stash Worker bindings on globalThis.__MCP_ENV so the shared `getEnv()`
 * helper (src/utils/env.ts) can read them. Idempotent — runs once per
 * isolate.
 *
 * Why globalThis instead of writing to process.env:
 *   First attempt mutated `process.env.X = env.X`. That appeared to no-op
 *   against the live Workers deploy — process.env is exposed by the
 *   nodejs_compat polyfill but is effectively read-only for secrets.
 *   Stashing on globalThis sidesteps the polyfill entirely; the helper
 *   in utils/env.ts checks the bridge first, then falls back to
 *   process.env for the Node path.
 */
function bridgeEnv(env: WorkerEnv): void {
  if (envBridged) return;
  (globalThis as { __MCP_ENV?: Record<string, string | undefined> }).__MCP_ENV = {
    WHO_CLIENT_ID: env.WHO_CLIENT_ID,
    WHO_CLIENT_SECRET: env.WHO_CLIENT_SECRET,
    WHO_ICD11_RELEASE_ID: env.WHO_ICD11_RELEASE_ID,
    ENABLE_SNOMED_TOOLS: env.ENABLE_SNOMED_TOOLS,
    SNOMED_BASE_URL: env.SNOMED_BASE_URL,
    SNOMED_LANGUAGE: env.SNOMED_LANGUAGE,
    LOG_LEVEL: env.LOG_LEVEL,
  };
  envBridged = true;
}

/**
 * Build a fresh MCP server + transport for a single request. In stateless
 * mode (no sessionIdGenerator) the SDK forbids reusing a transport across
 * requests — `handleRequest` throws "Stateless transport cannot be reused
 * across requests" on the second call — because a shared transport would
 * collide message IDs between concurrent clients. So we create both per
 * request. `createServer()` only wires up in-memory handlers against the
 * module-level registries (no network, no I/O), so the per-request cost is
 * a few object allocations, not a cold start.
 */
async function createRequestTransport(): Promise<WebStandardStreamableHTTPServerTransport> {
  const mcpServer = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });
  await mcpServer.connect(transport);
  return transport;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Mcp-Session-Id, Last-Event-Id, Mcp-Protocol-Version',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  };
}

function healthResponse(): Response {
  const uptimeMs = isolateStartMs === null ? 0 : Date.now() - isolateStartMs;
  return new Response(
    JSON.stringify({
      status: 'ok',
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      tool_count: toolRegistry.getTools().length,
      uptime_s: Math.round(uptimeMs / 10) / 100,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    },
  );
}

/**
 * 405 for GET/HEAD on the MCP endpoint.
 *
 * Why: in the Streamable HTTP transport, GET /mcp asks the server to open
 * the server-initiated SSE stream. This deployment is stateless with a
 * per-request transport, so no server-initiated message can ever be pushed:
 * the SDK would return a silent, never-closing SSE stream whose controller
 * becomes unreachable the moment this handler returns. Cloudflare's runtime
 * then cancels the request as hung ("would never generate a response") and
 * counts it as an error — observed at ~227k errors/day (99.6% error rate)
 * on 2026-06-10, driven by MCP clients stuck in SSE reconnect loops.
 *
 * The spec's escape hatch is explicit: servers that do not offer an SSE
 * stream at this endpoint MUST return HTTP 405 Method Not Allowed. A 405
 * also tells well-behaved clients to stop retrying the stream.
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */
function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message:
          'Method Not Allowed: this stateless server does not offer a server-initiated SSE stream. POST JSON-RPC messages to /mcp.',
      },
      id: null,
    }),
    {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        Allow: 'POST, DELETE, OPTIONS',
        ...corsHeaders(),
      },
    },
  );
}

function notFound(): Response {
  return new Response(
    JSON.stringify({
      error: 'Not Found',
      hint: 'POST JSON-RPC to /mcp; GET /health for liveness; GET /stats for usage counters',
    }),
    {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    },
  );
}

/**
 * Worker-side StatsRecorder — forwards to the single global StatsCounter
 * Durable Object via DO.fetch(). The fetch returns immediately (≤ a few
 * ms) but the DO call's full lifecycle is kept alive by ctx.waitUntil()
 * which the dispatcher accesses via globalThis.__MCP_WAIT_UNTIL.
 *
 * Reads (`read()`) are synchronous-ish — we await the DO's response and
 * return it. Used by /stats, /stats/badge, and the info://stats resource.
 */
class DurableObjectStatsRecorder implements StatsRecorder {
  private stub: DurableObjectStub;

  constructor(namespace: DurableObjectNamespace) {
    // Single named instance — every isolate gets the same DO, which is
    // the whole point of using DO for counters.
    const id = namespace.idFromName('global');
    this.stub = namespace.get(id);
  }

  async increment(toolName: string): Promise<void> {
    await this.stub.fetch(
      new Request('https://do/increment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: toolName }),
      }),
    );
  }

  async read(): Promise<StatsPayload | null> {
    const response = await this.stub.fetch(new Request('https://do/read', { method: 'GET' }));
    if (!response.ok) return null;
    return (await response.json()) as StatsPayload;
  }
}

let statsBridged = false;
function bridgeStats(env: WorkerEnv): void {
  if (statsBridged) return;
  if (env.STATS) {
    setStatsRecorder(new DurableObjectStatsRecorder(env.STATS));
  }
  // If the binding is missing (e.g. local dev without DO migrations applied)
  // we leave the Noop recorder in place — incrementing is harmless, reads
  // return null, and the info://stats resource renders its placeholder.
  statsBridged = true;
}

/**
 * GET /stats — full JSON payload for human/programmatic consumption.
 * Cached briefly via Cache-Control so a curl-loop or badge-poller
 * doesn't hammer the DO. 60s is short enough for fresh-feeling numbers,
 * long enough to absorb traffic spikes.
 */
async function statsResponse(env: WorkerEnv): Promise<Response> {
  const payload = await new DurableObjectStatsRecorder(env.STATS!).read();
  const body = payload ?? {
    scope: 'hosted endpoint at medical-terminologies-mcp.sidneybissoli.workers.dev',
    since: null,
    as_of: new Date().toISOString(),
    total_invocations: 0,
    by_tool: {},
    top_tool: null,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      ...corsHeaders(),
    },
  });
}

/**
 * GET /stats/badge — shields.io endpoint format. The badge URL in README
 * is `https://img.shields.io/endpoint?url=<encoded>/stats/badge` and
 * shields.io polls this every few minutes to refresh the badge image.
 *
 * Color thresholds reflect adoption signal: zero (lightgrey, "no data
 * yet"), <100 (yellow, "early days"), <1000 (blue, "growing"),
 * ≥1000 (brightgreen, "real traction"). Adjustable as the project
 * matures.
 */
async function statsBadgeResponse(env: WorkerEnv): Promise<Response> {
  const payload = await new DurableObjectStatsRecorder(env.STATS!).read();
  const total = payload?.total_invocations ?? 0;
  const color =
    total === 0
      ? 'lightgrey'
      : total < 100
        ? 'yellow'
        : total < 1000
          ? 'blue'
          : 'brightgreen';
  const body = {
    schemaVersion: 1,
    label: 'tool calls',
    message: total.toLocaleString('en-US'),
    color,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      ...corsHeaders(),
    },
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    // First fetch sets the uptime baseline. Date.now() inside a request
    // handler is the real clock, unlike at module-init time.
    if (isolateStartMs === null) {
      isolateStartMs = Date.now();
    }

    // Bridge Worker bindings into process.env so platform-agnostic clients
    // (who-client.ts etc.) see the credentials. Idempotent per isolate.
    bridgeEnv(env);
    bridgeStats(env);

    // Expose ctx.waitUntil to the dispatcher so the fire-and-forget stats
    // increment in server-core.ts keeps the isolate alive long enough to
    // flush its DO RPC after the response is sent. Set on every request
    // (not cached) because ctx instances are per-request.
    (globalThis as { __MCP_WAIT_UNTIL?: (p: Promise<unknown>) => void }).__MCP_WAIT_UNTIL =
      ctx.waitUntil.bind(ctx);

    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return healthResponse();
    }

    if (request.method === 'GET' && url.pathname === '/stats') {
      return statsResponse(env);
    }

    if (request.method === 'GET' && url.pathname === '/stats/badge') {
      return statsBadgeResponse(env);
    }

    if (url.pathname === '/mcp' || url.pathname === '/') {
      // Reject the SSE-stream GET before it reaches the SDK transport — see
      // methodNotAllowed() docstring for the full rationale (hang → canceled
      // request → error-rate blowup → client reconnect loop).
      if (request.method === 'GET' || request.method === 'HEAD') {
        return methodNotAllowed();
      }
      try {
        const t = await createRequestTransport();
        const response = await t.handleRequest(request);
        // Layer CORS on top of whatever the transport produced.
        for (const [key, value] of Object.entries(corsHeaders())) {
          response.headers.set(key, value);
        }
        return response;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: msg }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
    }

    return notFound();
  },
};
