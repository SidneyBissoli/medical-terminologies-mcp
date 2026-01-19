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

// Tool imports - Phase 1: ICD-11
import { registerICD11Tools } from './tools/icd11.js';

// Future phases (uncomment as implemented)
// import { registerLOINCTools } from './tools/loinc.js';
// import { registerRxNormTools } from './tools/rxnorm.js';
// import { registerMeSHTools } from './tools/mesh.js';
// import { registerSNOMEDTools } from './tools/snomed.js';
// import { registerCrosswalkTools } from './tools/crosswalk.js';

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    process.stderr.write(`[info] Initializing ${SERVER_INFO.name}...\n`);

    // Register all tools before creating server
    registerICD11Tools();
    // registerLOINCTools();
    // registerRxNormTools();
    // registerMeSHTools();
    // registerSNOMEDTools();
    // registerCrosswalkTools();

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
