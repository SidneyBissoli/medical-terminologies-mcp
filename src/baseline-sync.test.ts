/**
 * The newest surface baseline matches the registered surface — checked in
 * the PR, not after the deploy.
 *
 * Why this exists (2026-10-03): `scripts/smoke-mcp.mjs` derives the expected
 * tool count from the most recent `baselines/surface-stdio-<version>.json`.
 * Releases 1.18.0 and 1.18.1 added `harmonize_terms` without recapturing the
 * baseline, so the PRs were green, the Worker deployed, and then the
 * production smoke failed both deploys ("expected 33, got 34") — the
 * workflow ended in failure and the post-deploy mcpscore audit was skipped.
 * The same comparison, offline and against the registry, turns the PR red.
 *
 * Recapture: `npm run build && node scripts/dump-surface.mjs --stdio >
 * baselines/surface-stdio-<version>.json`, plus a row in baselines/README.md.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toolRegistry } from './server-core.js';
import './register.js';

const BASELINES = join(dirname(fileURLToPath(import.meta.url)), '..', 'baselines');

// Same selection rule as scripts/smoke-mcp.mjs: highest semver wins.
const versionOf = (name: string): number[] =>
  (name.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
const latest = readdirSync(BASELINES)
  .filter((f) => /^surface-stdio-\d+\.\d+\.\d+\.json$/.test(f))
  .sort((a, b) => {
    const [va, vb] = [versionOf(a), versionOf(b)];
    return va[0] - vb[0] || va[1] - vb[1] || va[2] - vb[2];
  })
  .at(-1);

describe('surface baseline is in sync with the registry (what the production smoke compares)', () => {
  it('a stdio baseline exists', () => {
    expect(latest, 'no baselines/surface-stdio-*.json').toBeDefined();
  });

  it(`the newest baseline (${latest}) lists exactly the registered tools`, () => {
    const baseline = JSON.parse(readFileSync(join(BASELINES, latest!), 'utf8')) as {
      toolCount: number;
      tools: { name: string }[];
    };
    const registered = toolRegistry.getTools().map((t) => t.name).sort();
    const recorded = baseline.tools.map((t) => t.name).sort();
    expect(
      recorded,
      `${latest} is stale — recapture it (see the header of this file)`,
    ).toEqual(registered);
    expect(baseline.toolCount).toBe(registered.length);
  });
});
