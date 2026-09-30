/**
 * The telemetry class of an error comes from its TYPE, not its phrase.
 *
 * Measured on 2026-09-30 by running `classifyError` over the text
 * `handleToolError` builds ("API error (CODE): ..."): network ("fetch
 * failed"), abort, 429 ("Rate limit exceeded"), 403 and 5xx with an HTML body
 * (whose text replaces the status in `extractErrorMessage`) all landed in
 * `outro`. The typed error (`ApiError.code`/`statusCode`) existed in the
 * handler's `catch`; only the text reached the hook.
 *
 * The test goes through the WHOLE path — mocked fetch, HttpClient, client,
 * handler, `handleToolError`, the `registerAll` hook — because the loss
 * happened in the middle of it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { registerAll } from './register.js';
import { cache } from './utils/cache.js';
import { handleToolError } from './utils/zod-schema.js';
import { classeAnexada } from './call-shape.js';
import { ApiError } from './types/index.js';

async function chamar(tool: string, args: Record<string, unknown>) {
  const classes: string[] = [];
  const server = new McpServer({ name: 'classe-do-erro', version: '0.0.0' });
  registerAll(server, (kind, _name, forma) => {
    if (kind === 'tool_error' && forma) classes.push(forma.classe);
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'classe-do-erro', version: '1.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);

  const pendente = client.callTool({ name: tool, arguments: args });
  // Backoff between attempts and the rate limiter run on the fake clock.
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(15_000);
  const result = await pendente;
  return { result, classes };
}

function responder(fn: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(fn));
}

beforeEach(() => {
  vi.useFakeTimers();
  cache.flush();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BUSCA = { query: 'aspirin' };

describe('a source failure is `fonte`', () => {
  it('network', async () => {
    responder(async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND rxnav.nlm.nih.gov') });
    });
    const { result, classes } = await chamar('rxnorm_search', BUSCA);
    expect(result.isError).toBe(true);
    // The text the caller reads is unchanged.
    expect(JSON.stringify(result.content)).toContain('ENOTFOUND');
    expect(classes).toEqual(['fonte']);
  });

  it('429 — "Rate limit exceeded" fell in `outro`', async () => {
    responder(async () => new Response('', { status: 429 }));
    const { classes } = await chamar('rxnorm_search', BUSCA);
    expect(classes).toEqual(['fonte']);
  });

  it('403', async () => {
    responder(async () => new Response('Forbidden', { status: 403 }));
    const { classes } = await chamar('rxnorm_search', BUSCA);
    expect(classes).toEqual(['fonte']);
  });

  it('5xx with an HTML body — the body replaced the status in the phrase', async () => {
    responder(
      async () =>
        new Response('<html><body>Service Unavailable</body></html>', {
          status: 503,
          headers: { 'content-type': 'text/html' },
        }),
    );
    const { classes } = await chamar('rxnorm_search', BUSCA);
    expect(classes).toEqual(['fonte']);
  });
});

describe('what the type does not settle stays with the phrase', () => {
  it('NOT_FOUND is an answered absence', () => {
    const r = handleToolError(new ApiError('Resource not found', 'NOT_FOUND', 404));
    expect(classeAnexada(r)).toBe('nao_encontrado');
  });

  it('a 400 declares nothing — never measured as the caller’s fault or the source’s', () => {
    const r = handleToolError(new ApiError('NLM API error: bad', 'API_ERROR', 400));
    expect(classeAnexada(r)).toBeUndefined();
  });

  it('the operator’s missing credentials declare nothing', () => {
    const r = handleToolError(new ApiError('WHO API credentials not configured.', 'AUTH_CONFIG_ERROR'));
    expect(classeAnexada(r)).toBeUndefined();
  });
});

describe('the class travels OFF the wire', () => {
  it('the serialized result gains no key', async () => {
    responder(async () => new Response('', { status: 429 }));
    const { result } = await chamar('rxnorm_search', BUSCA);
    expect(Object.keys(result).sort()).toEqual(['content', 'isError']);
  });
});
