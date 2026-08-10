/**
 * Offline regression signal of the tool-selection eval: fixtures validated
 * against the LIVE catalog (extracted by running the real `registerAll`)
 * plus the project-specific invariants (exact tool count, cluster
 * partition complete, advertised schemas attached). Renaming/removing a
 * tool breaks this immediately — no network, no model.
 */

import { describe, it, expect } from 'vitest';
import { validateFixtures } from '@sbissoli/mcp-evals';
import { AREA_BY_TOOL, CATALOG } from './catalog.js';
import { FIXTURES } from './fixtures/queries.js';

describe('eval catalog (live, via registerAll)', () => {
  it('captures exactly the 31 default tools', () => {
    expect(CATALOG.tools).toHaveLength(31);
  });

  it('the cluster partition covers every tool, with no stale entries', () => {
    const catalogNames = [...CATALOG.toolNames].sort();
    expect(Object.keys(AREA_BY_TOOL).sort()).toEqual(catalogNames);
  });

  it('every tool has a non-empty description (the model’s only selection signal)', () => {
    for (const tool of CATALOG.tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
    }
  });

  it('every tool carries its real advertised input schema (re-attached from the registry)', () => {
    for (const tool of CATALOG.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
    // Spot-check a non-trivial schema survived the trip.
    const findEq = CATALOG.tools.find((t) => t.name === 'find_equivalent');
    expect(Object.keys(findEq!.inputSchema.properties)).toContain('term');
  });
});

describe('eval fixtures (terminology-cluster selection check)', () => {
  it('fixtures are valid against the live catalog', () => {
    expect(
      validateFixtures(FIXTURES, CATALOG, { minFixtures: 30, maxFixtures: 50, minAreas: 8 }),
    ).toEqual([]);
  });

  it('fixture ids carry the cluster tag', () => {
    for (const f of FIXTURES) {
      expect(f.id).toMatch(/^(icd|cid|lnc|rx|atc|msh|xw|ver)-\d{2}$/);
    }
  });

  it('all eight clusters are exercised', () => {
    const prefixes = new Set(FIXTURES.map((f) => f.id.split('-')[0]));
    expect([...prefixes].sort()).toEqual(['atc', 'cid', 'icd', 'lnc', 'msh', 'rx', 'ver', 'xw']);
  });

  it('the find_equivalent vs dedicated-search boundary is exercised in both directions', () => {
    const xw = FIXTURES.filter((f) => f.id.startsWith('xw-'));
    expect(xw.some((f) => f.expectedTools.includes('find_equivalent'))).toBe(true);
    expect(xw.some((f) => f.expectedTools.includes('icd11_search'))).toBe(true);
  });

  it('the pt-BR subset covers cid10 natively and the official-translation params (D2-C)', () => {
    const ptQueries = FIXTURES.filter((f) => /[ãõçáéíóú]/i.test(f.query));
    expect(ptQueries.length).toBeGreaterThanOrEqual(5);
    expect(ptQueries.some((f) => f.expectedTools.includes('cid10_search'))).toBe(true);
    expect(ptQueries.some((f) => f.expectedTools.includes('icd11_search'))).toBe(true);
    expect(ptQueries.some((f) => f.expectedTools.includes('mesh_descriptor'))).toBe(true);
  });
});
