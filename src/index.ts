#!/usr/bin/env node
/**
 * Medical Terminologies MCP Server — stdio entry point.
 *
 * Serves the shared tool/prompt/resource surface (built in
 * `src/register.ts`) over the stdio transport via the SDK v2's
 * `serveStdio`, which pins one server instance from the factory per
 * connection and serves both the modern and the 2025-era protocol
 * openings.
 *
 * The 1.x-era `--http` mode was removed in the v2 migration: HTTP is the
 * hosted Worker's job (worker/ — Fase 0 template), and a local HTTP
 * transport is available via `cd worker && npm run dev`.
 *
 * stdout is the MCP protocol channel — all logging goes to stderr (pino
 * is configured for fd 2 on Node; see src/utils/logger.ts).
 *
 * @author Sidney Bissoli
 * @license MIT
 */
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { unknownCursorError } from './pagination.js';
import { createServer } from './register.js';
import { SERVER_INFO } from './server-core.js';
import { logger } from './utils/logger.js';

// The transport is built here rather than left to `serveStdio` so the cursor
// guard below can hook onto it.
const transport = new StdioServerTransport();

serveStdio(() => createServer(), {
  transport,
  onerror: (error) => {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ err: msg }, 'Transport error');
  },
});

// Invalid pagination cursor -> -32602, the SAME guard the Worker applies on its
// POST (see src/pagination.ts). It REPLACES `onmessage` rather than adding a
// listener: only whatever sits in `onmessage` can stop delivery to the SDK, and
// stopping delivery is what produces the refusal. Runs after `serveStdio`,
// which is what installs the transport's `onmessage`.
const deliverToServer = transport.onmessage;
transport.onmessage = (message) => {
  const refusal = unknownCursorError(message);
  if (refusal) {
    void transport.send(refusal);
    return;
  }
  deliverToServer?.(message);
};

// Flush pino's async buffer on shutdown signals — stdio teardown itself is
// owned by serveStdio; we only make sure buffered log lines reach stderr.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.flush();
    process.exit(0);
  });
}

logger.info(
  { server: SERVER_INFO.name, version: SERVER_INFO.version },
  'Server started over stdio',
);
