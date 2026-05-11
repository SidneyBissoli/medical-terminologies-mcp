/**
 * Cross-runtime env var access.
 *
 * Node (stdio + Node HTTP server) reads from `process.env` directly. That
 * stops working on Cloudflare Workers: even with `nodejs_compat`, secrets
 * set via `wrangler secret put` are not bridged into `process.env` (writes
 * to it appear to no-op against a Proxy on the Workers runtime — verified
 * against the live deploy 2026-05-10). To unblock the Workers path without
 * a constructor-injection refactor of every client, `src/worker.ts` stashes
 * the Worker bindings on `globalThis.__MCP_ENV` at first request, and this
 * helper checks that first before falling back to `process.env`.
 *
 * Callers (who-client.ts, snomed-client.ts) just use `getEnv('KEY')` instead
 * of `process.env.KEY`. No-op overhead on Node; correctness fix on Workers.
 */

interface EnvBridge {
  [key: string]: string | undefined;
}

export function getEnv(key: string): string | undefined {
  const bridge = (globalThis as { __MCP_ENV?: EnvBridge }).__MCP_ENV;
  if (bridge) {
    const v = bridge[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  if (typeof process !== 'undefined' && process.env) {
    const v = process.env[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
