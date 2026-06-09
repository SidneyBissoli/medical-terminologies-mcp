import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHttpServer, toolRegistry } from './server.js';
import type { Server as HttpServer } from 'node:http';

// One tool module is enough to verify the transport routes JSON-RPC
// correctly. CID-10 is a no-network module (bundled dataset) so the test
// stays hermetic.
import './tools/cid10.js';

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

describe('Streamable HTTP transport', () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    const result = await startHttpServer(0, '127.0.0.1');
    httpServer = result.httpServer;
    const addr = httpServer.address();
    if (typeof addr !== 'object' || !addr) throw new Error('http server has no port');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  async function postJsonRpc(body: unknown): Promise<{ status: number; data: JsonRpcResponse | string }> {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    // Streamable HTTP can respond as either application/json or text/event-stream.
    // For the SSE case we extract the data: line; for plain JSON we parse directly.
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

  it('GET /health returns liveness payload', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      name: string;
      tool_count: number;
      uptime_s: number;
    };
    expect(body.status).toBe('ok');
    expect(body.name).toBe('medical-terminologies-mcp');
    expect(body.tool_count).toBe(toolRegistry.getTools().length);
    expect(typeof body.uptime_s).toBe('number');
    expect(body.uptime_s).toBeGreaterThanOrEqual(0);
  });

  it('OPTIONS /mcp returns CORS preflight', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('initialize → tools/list returns the registered tool surface', async () => {
    const initRes = await postJsonRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'http-contract-test', version: '1.0' },
      },
    });
    expect(initRes.status).toBe(200);
    expect(typeof initRes.data).toBe('object');
    const initBody = initRes.data as JsonRpcResponse<{ serverInfo: { name: string } }>;
    expect(initBody.error).toBeUndefined();
    expect(initBody.result?.serverInfo.name).toBe('medical-terminologies-mcp');

    const listRes = await postJsonRpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    expect(listRes.status).toBe(200);
    const listBody = listRes.data as JsonRpcResponse<{ tools: Array<{ name: string }> }>;
    expect(listBody.error).toBeUndefined();
    expect(Array.isArray(listBody.result?.tools)).toBe(true);
    const toolNames = listBody.result!.tools.map((t) => t.name);
    expect(toolNames).toContain('cid10_search');
  });

  it('unknown path returns 404 with hint', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toBe('Not Found');
    expect(body.hint).toMatch(/\/mcp/);
  });
});
