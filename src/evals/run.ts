/**
 * Tool-selection eval — REAL-MODEL run (Anthropic Messages API).
 *
 * COSTS MONEY: bills API usage separately from any Claude subscription.
 * Never run with ANTHROPIC_API_KEY set unless the decision-maker
 * explicitly asked for a round. Without the key it prints instructions
 * and exits 0 (CI-safe). The offline regression signal is
 * `src/evals/fixtures.test.ts` (runs inside `npm test`).
 *
 * Run: npx tsx src/evals/run.ts
 * Env vars (optional): EVAL_MODEL, EVAL_CONCURRENCY, EVAL_LIMIT.
 * Results are recorded in evals/results/ (repo root).
 */

import { runEval } from '@sbissoli/mcp-evals';
import { CATALOG } from './catalog.js';
import { FIXTURES } from './fixtures/queries.js';

const { exitCode } = await runEval({
  catalog: CATALOG,
  fixtures: FIXTURES,
  systemPrompt:
    'You are the tool router for the medical-terminologies MCP server (seven medical ' +
    'terminologies under one contract: ICD-11, LOINC, RxNorm, ATC, MeSH, the Brazilian ' +
    'Portuguese CID-10, SNOMED CT, plus authoritative ICD-10→ICD-11 mapping, batch code ' +
    'validation, ranked cross-terminology search, and version metadata). Given the user query, ' +
    'choose the single most appropriate tool from the catalog and call it. Do not answer in ' +
    'text; just call the tool.',
});

process.exit(exitCode);
