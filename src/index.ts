#!/usr/bin/env node
/**
 * Medical Terminologies MCP Server
 *
 * Entry point for the MCP server that provides unified access to
 * major medical terminologies including:
 * - ICD-11 (WHO International Classification of Diseases)
 * - SNOMED CT (Systematized Nomenclature of Medicine)
 * - LOINC (Logical Observation Identifiers Names and Codes)
 * - RxNorm (Normalized names for clinical drugs)
 * - MeSH (Medical Subject Headings)
 *
 * @author Sidney Bissoli
 * @license MIT
 */
import { createServer, startServer, startHttpServer, SERVER_INFO } from './server.js';
import { logger } from './utils/logger.js';

// Tool imports - tools register themselves when imported (side-effect)
// Phase 1: ICD-11
import './tools/icd11.js';
// Phase 2: LOINC
import './tools/loinc.js';
// Phase 3: RxNorm
import './tools/rxnorm.js';
// Phase 4: MeSH
import './tools/mesh.js';
// Phase 5: SNOMED CT
import './tools/snomed.js';
// Phase 6: Crosswalk
import './tools/crosswalk.js';
// Phase 7: ATC (via NLM RxClass)
import './tools/atc.js';
// Phase 8: CID-10 (Brazilian, DataSUS V2008, bundled dataset)
import './tools/cid10.js';

// Prompts — orchestration templates exposed to MCP clients
import './prompts/index.js';

// Resources — static reference content exposed by URI
import './resources/index.js';

interface CliOptions {
  http: boolean;
  port: number;
  host: string;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const http = args.includes('--http') || process.env.MCP_HTTP === 'true';

  const portIdx = args.indexOf('--port');
  const portArg = portIdx >= 0 ? args[portIdx + 1] : process.env.PORT;
  const port = portArg !== undefined ? Number.parseInt(portArg, 10) : 3000;
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port "${portArg}" — must be an integer in [0, 65535]`);
  }

  const hostIdx = args.indexOf('--host');
  const host = hostIdx >= 0 ? (args[hostIdx + 1] ?? '127.0.0.1') : (process.env.HOST ?? '127.0.0.1');

  return { http, port, host };
}

/**
 * Installs SIGINT/SIGTERM handlers that call closeFn once, race it against
 * a 5s timeout (so a stuck close() can't block teardown), flush pino's
 * async buffer, then exit. Idempotent on repeated signals.
 */
function installShutdown(closeFn: () => Promise<void>): void {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down...');

    try {
      await Promise.race([
        closeFn(),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, 'Error closing server, continuing shutdown');
    }

    logger.flush();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function main(): Promise<void> {
  try {
    const opts = parseArgs(process.argv);
    logger.info({ server: SERVER_INFO.name, transport: opts.http ? 'http' : 'stdio' }, 'Initializing server...');

    const server = createServer();

    if (opts.http) {
      const { httpServer } = await startHttpServer(server, opts.port, opts.host);
      installShutdown(async () => {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        await server.close();
      });
    } else {
      await startServer(server);
      installShutdown(() => server.close());
    }

    logger.info({ server: SERVER_INFO.name, version: SERVER_INFO.version }, 'Server started');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.fatal({ error: errorMessage }, 'Failed to start server');
    process.exit(1);
  }
}

main();