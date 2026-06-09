import { describe, it, expect } from 'vitest';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import worker from './worker.js';
import { createServer } from './server-core.js';

// CID-10 is a no-network module (bundled dataset), so exercising the Workers
// fetch handler stays hermetic — no upstream API or auth needed. cid10.js is
// already side-effect-imported by worker.ts, so the tool is registered.

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

// Minimal ExecutionContext stand-in. The dispatcher's fire-and-forget stats
// increment reaches for ctx.waitUntil (bridged via globalThis.__MCP_WAIT_UNTIL);
// it only needs to be callable. No DO binding is set, so the Noop stats
// recorder stays in place and incrementing is harmless.
const ctx = { waitUntil: () => {} };
const env = {} as Parameters<typeof worker.fetch>[1];

async function workerFetch(body: unknown): Promise<{ status: number; data: JsonRpcResponse | string }> {
  const res = await worker.fetch(
    new Request('https://worker.test/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );
  const text = await res.text();
  // Streamable HTTP may answer as application/json or text/event-stream;
  // unwrap both, mirroring src/server.http.test.ts.
  const ct = res.headers.get('content-type') ?? '';
  let data: JsonRpcResponse | string = text;
  if (ct.includes('application/json')) {
    data = JSON.parse(text) as JsonRpcResponse;
  } else if (ct.includes('text/event-stream')) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
    if (dataLine) data = JSON.parse(dataLine.slice('data: '.length)) as JsonRpcResponse;
  }
  return { status: res.status, data };
}

describe('Workers fetch handler', () => {
  it('GET /health returns liveness payload', async () => {
    const res = await worker.fetch(new Request('https://worker.test/health'), env, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; name: string };
    expect(body.status).toBe('ok');
    expect(body.name).toBe('medical-terminologies-mcp');
  });

  it('serves tools/list on a SECOND request (per-request transport, not a reused one)', async () => {
    // Regression pin for the stateless-transport-reuse bug: SDK >= 1.28 throws
    // "Stateless transport cannot be reused across requests" on the second
    // handleRequest of a shared transport. The worker must build a fresh
    // transport per request. initialize and tools/list arrive as two
    // independent fetches, so a reused transport would 500 the second one.
    const initRes = await workerFetch({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'worker-contract-test', version: '1.0' },
      },
    });
    expect(initRes.status).toBe(200);
    const initBody = initRes.data as JsonRpcResponse<{ serverInfo: { name: string } }>;
    expect(initBody.error).toBeUndefined();
    expect(initBody.result?.serverInfo.name).toBe('medical-terminologies-mcp');

    const listRes = await workerFetch({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(listRes.status).toBe(200);
    const listBody = listRes.data as JsonRpcResponse<{ tools: Array<{ name: string }> }>;
    expect(listBody.error).toBeUndefined();
    expect(listBody.result!.tools.map((t) => t.name)).toContain('cid10_search');
  });
});

describe('WebStandardStreamableHTTPServerTransport stateless contract', () => {
  it('rejects reuse across requests — documents why the worker builds one per request', async () => {
    // This is the upstream behavior the per-request pattern works around.
    // If a future SDK drops the guard this test goes red and we can simplify;
    // if a refactor reintroduces a shared transport, the worker test above
    // catches it. Together they pin both sides of the contract.
    const server = createServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });
    await server.connect(transport);

    const makeReq = (id: number, method: string, params?: unknown) =>
      new Request('https://worker.test/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });

    const first = await transport.handleRequest(
      makeReq(1, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'reuse-test', version: '1.0' },
      }),
    );
    expect(first.status).toBe(200);

    await expect(transport.handleRequest(makeReq(2, 'tools/list'))).rejects.toThrow(
      /cannot be reused across requests/i,
    );

    await transport.close();
    await server.close();
  });
});
