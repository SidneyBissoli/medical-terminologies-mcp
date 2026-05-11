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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
// IMPORTANT: import from server-core.js, NOT server.js — the latter pulls
// in node:http and @hono/node-server which don't exist in Workers.
import { createServer, SERVER_INFO, toolRegistry } from './server-core.js';

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

// Per-isolate startup timestamp for the /health uptime field. This measures
// how long THIS isolate has been alive, not the overall service uptime —
// Cloudflare may spin up new isolates and discard idle ones at any time.
const isolateStartMs = Date.now();

let mcpServer: Server | null = null;
let transport: WebStandardStreamableHTTPServerTransport | null = null;

/**
 * Lazy init the MCP server + transport once per isolate. Top-level await
 * in Workers is technically allowed but adds startup latency on cold
 * isolates; doing it on first request keeps the cold path predictable.
 */
async function ensureInit(): Promise<WebStandardStreamableHTTPServerTransport> {
  if (transport) return transport;
  mcpServer = createServer();
  transport = new WebStandardStreamableHTTPServerTransport({
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
  return new Response(
    JSON.stringify({
      status: 'ok',
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      tool_count: toolRegistry.getTools().length,
      uptime_s: Math.round((Date.now() - isolateStartMs) / 10) / 100,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    },
  );
}

function notFound(): Response {
  return new Response(
    JSON.stringify({
      error: 'Not Found',
      hint: 'POST JSON-RPC to /mcp; GET /health for liveness',
    }),
    {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    },
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return healthResponse();
    }

    if (url.pathname === '/mcp' || url.pathname === '/') {
      try {
        const t = await ensureInit();
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
