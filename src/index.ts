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
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './register.js';
import { SERVER_INFO } from './server-core.js';
import { logger } from './utils/logger.js';

serveStdio(() => createServer(), {
  onerror: (error) => {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ err: msg }, 'Transport error');
  },
});

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
