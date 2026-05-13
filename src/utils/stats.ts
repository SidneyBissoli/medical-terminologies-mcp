/**
 * Cross-runtime stats recorder — the dispatcher in server-core.ts calls
 * `getStatsRecorder().increment(toolName)` after every successful tool
 * dispatch, regardless of whether we're running on Node (stdio) or
 * Cloudflare Workers. The concrete implementation differs:
 *
 *   - Node (stdio):   `NoopStatsRecorder` — no shared state to aggregate
 *                     across local installs (privacy-preserving by design).
 *   - Workers:        `setStatsRecorder()` is called from worker.ts on
 *                     first request with a recorder that fans out to a
 *                     single `StatsCounter` Durable Object.
 *
 * Why the indirection: server-core.ts is the shared dispatcher used by
 * both entrypoints. It can't `import` anything Worker-specific without
 * breaking the Node build (the DO type isn't available there), and it
 * can't reach into globalThis directly without becoming opaque. This
 * module is the one place that bridges both worlds; the dispatcher only
 * sees the abstract interface.
 *
 * Why fire-and-forget: counter writes should never add latency to user
 * requests. The Worker entry uses ctx.waitUntil to keep the isolate
 * alive long enough to flush the write after the response is sent.
 */

import { logger } from './logger.js';

export interface StatsPayload {
  scope: string;
  since: string | null;
  as_of: string;
  total_invocations: number;
  by_tool: Record<string, number>;
  top_tool: string | null;
}

export interface StatsRecorder {
  increment(toolName: string): Promise<void>;
  read(): Promise<StatsPayload | null>;
}

/**
 * Default recorder used on Node (stdio). Counter increments are no-ops;
 * `read()` returns null so the `info://stats` resource can render a
 * "stats unavailable in stdio mode" placeholder instead of throwing.
 */
class NoopStatsRecorder implements StatsRecorder {
  async increment(): Promise<void> {
    // intentionally empty
  }

  async read(): Promise<StatsPayload | null> {
    return null;
  }
}

let recorder: StatsRecorder = new NoopStatsRecorder();

/**
 * Swap in a concrete recorder. Called from `src/worker.ts` on first
 * request to install a Durable-Object-backed recorder; never called on
 * the Node path (recorder stays Noop there).
 */
export function setStatsRecorder(r: StatsRecorder): void {
  recorder = r;
}

export function getStatsRecorder(): StatsRecorder {
  return recorder;
}

/**
 * Fire-and-forget increment helper used by the dispatcher. Wraps the
 * underlying recorder call in a swallow-errors block so a failing
 * counter never propagates up and breaks the user's tool response.
 *
 * The Worker path also bridges this through `globalThis.__MCP_WAIT_UNTIL`
 * so the platform's `ctx.waitUntil` keeps the isolate alive long enough
 * for the DO RPC to flush after the response is sent.
 */
export function recordInvocation(toolName: string): void {
  const promise = recorder.increment(toolName).catch((err) => {
    logger.warn({ err: String(err), tool: toolName }, 'stats increment failed (non-fatal)');
  });

  const waitUntil = (globalThis as { __MCP_WAIT_UNTIL?: (p: Promise<unknown>) => void })
    .__MCP_WAIT_UNTIL;
  if (waitUntil) {
    waitUntil(promise);
  }
  // On Node (stdio) there's no waitUntil; the Noop recorder finishes
  // synchronously anyway, so the unawaited promise is harmless.
}
