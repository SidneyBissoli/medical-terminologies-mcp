/**
 * Node-only server entrypoint helpers — stdio transport (for Claude
 * Desktop / IDE clients) and Streamable HTTP transport via `node:http`
 * (for self-hosted Docker / Fly.io / Render). Cloudflare Workers uses
 * `src/worker.ts` instead, which talks Web Standard Request/Response
 * directly to `WebStandardStreamableHTTPServerTransport`.
 *
 * The actual MCP server construction, tool registry, and SERVER_INFO
 * live in `src/server-core.ts` so they can be shared between runtimes.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer, SERVER_INFO, toolRegistry } from './server-core.js';
import { logger } from './utils/logger.js';

// Re-exports so existing callers (src/index.ts, tools, tests) keep their
// `from './server.js'` imports without churn.
export { SERVER_INFO, toolRegistry, createServer } from './server-core.js';
export type { ToolHandler } from './server-core.js';

export async function startServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      tool_count: toolRegistry.getTools().length,
    },
    'Server started over stdio',
  );
}

/**
 * Starts the MCP server with Streamable HTTP transport in stateless mode.
 *
 * Stateless was chosen over stateful so each request is independent — no
 * session storage on the server side. This is what hosted-runtime targets
 * (Cloudflare Workers, Smithery, etc.) expect, and it keeps the local-dev
 * story simple (no session-cookie tracking, no Mcp-Session-Id headers to
 * thread through curl).
 *
 * Each /mcp request gets a freshly constructed Server + transport. In
 * stateless mode the SDK forbids reusing a transport across requests
 * (`handleRequest` throws "Stateless transport cannot be reused across
 * requests" on the second call) because a shared transport would collide
 * message IDs between concurrent clients. `createServer()` only wires up
 * in-memory handlers against the module-level registries, so the per-request
 * cost is a few object allocations.
 *
 * @param port - TCP port to listen on (use 0 for an ephemeral port in tests)
 * @param host - Bind address. Defaults to 127.0.0.1 (loopback) so a dev
 *               machine doesn't accidentally expose the server. Pass
 *               '0.0.0.0' for container/hosted deployments.
 * @returns The underlying http.Server (for shutdown).
 */
async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  // Tear down the per-request server + transport once the response is done,
  // so we don't leak handlers/listeners across requests.
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export async function startHttpServer(
  port: number,
  host: string = '127.0.0.1',
): Promise<{ httpServer: HttpServer }> {
  const httpServer = createHttpServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Mcp-Session-Id, Last-Event-Id, Mcp-Protocol-Version',
    );
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    // Lightweight health probe for load balancers / uptime monitors —
    // does not exercise any tool, just confirms the process is alive.
    // Deliberately does NOT poll upstream APIs (WHO/NLM): a probe that
    // depends on third-party reachability would surface their transient
    // 5xxs as our outages and cause needless container restarts.
    if (req.method === 'GET' && req.url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200).end(
        JSON.stringify({
          status: 'ok',
          name: SERVER_INFO.name,
          version: SERVER_INFO.version,
          tool_count: toolRegistry.getTools().length,
          uptime_s: Math.round(process.uptime() * 100) / 100,
        }),
      );
      return;
    }

    if (req.url === '/mcp' || req.url === '/') {
      handleMcpRequest(req, res).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg, method: req.method, url: req.url }, 'HTTP transport error');
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: msg }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', hint: 'POST JSON-RPC to /mcp; GET /health for liveness' }));
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });

  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;

  logger.info(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      tool_count: toolRegistry.getTools().length,
      host,
      port: boundPort,
    },
    'Server started over Streamable HTTP',
  );

  return { httpServer };
}
