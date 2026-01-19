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

// Tool imports - tools register themselves when imported (side-effect)
// Phase 1: ICD-11
import './tools/icd11.js';

// Future phases (uncomment as implemented)
// import './tools/loinc.js';
// import './tools/rxnorm.js';
// import './tools/mesh.js';
// import './tools/snomed.js';
// import './tools/crosswalk.js';

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    process.stderr.write(`[info] Initializing ${SERVER_INFO.name}...\n`);

    const server = createServer();
    await startServer(server);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      process.stderr.write('[info] Received SIGINT, shutting down...\n');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      process.stderr.write('[info] Received SIGTERM, shutting down...\n');
      process.exit(0);
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[fatal] Failed to start server: ${errorMessage}\n`);
    process.exit(1);
  }
}

// Run the server
main();
