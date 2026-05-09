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
import { createServer, startServer, SERVER_INFO } from './server.js';
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

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    logger.info({ server: SERVER_INFO.name }, 'Initializing server...');

    const server = createServer();
    await startServer(server);

    logger.info({ server: SERVER_INFO.name, version: SERVER_INFO.version }, 'Server started');

    // Graceful shutdown: close the server's stdio transport so any in-flight
    // requests resolve, then flush pino's async destination, then exit.
    // Idempotent on repeated signals; bounded by a 5s timeout so a stuck
    // server.close() never blocks teardown indefinitely.
    let shuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, 'Shutting down...');

      try {
        await Promise.race([
          server.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err: msg }, 'Error closing server, continuing shutdown');
      }

      // pino is configured with sync: false, so async writes can still be
      // buffered when we get here. flush() drains the buffer.
      logger.flush();
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.fatal({ error: errorMessage }, 'Failed to start server');
    process.exit(1);
  }
}

// Run the server
main();