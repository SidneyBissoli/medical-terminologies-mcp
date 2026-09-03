/**
 * Provenance release gate, SNOMED-gated half: the 6 tools registered only
 * under ENABLE_SNOMED_TOOLS=true must attach the provenance channel too
 * (39 = 33 default + these 6). The flag is read at module load, so this
 * file sets the env FIRST and pulls the registry via dynamic import —
 * vitest isolates modules per test file, so the default-surface tests are
 * unaffected.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';

process.env.ENABLE_SNOMED_TOOLS = 'true';
process.env.SNOMED_BASE_URL = 'https://snowstorm.example.test/snomed-ct';

const snomedResult = {
  conceptId: '73211009',
  fsn: 'Diabetes mellitus (disorder)',
  pt: 'Diabetes mellitus',
  active: true,
  definitionStatus: 'FULLY_DEFINED',
  moduleId: '900000000000207008',
};

vi.mock('./clients/snomed-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSNOMEDClient: () => ({
    searchConcepts: async () => [snomedResult],
    getConcept: async () => ({ ...snomedResult, effectiveTime: '20250131' }),
    getParents: async () => [snomedResult],
    getChildren: async () => [snomedResult],
    getDescriptions: async () => [
      {
        descriptionId: '123',
        term: 'Diabetes mellitus',
        type: 'FSN',
        typeId: '900000000000003001',
        lang: 'en',
        active: true,
        caseSignificance: 'CASE_INSENSITIVE',
        acceptabilityMap: {},
      },
    ],
    executeECL: async () => [snomedResult],
  }),
}));

const GATED = [
  { nome: 'snomed_search', args: { query: 'diabetes' } },
  { nome: 'snomed_concept', args: { sctid: '73211009' } },
  { nome: 'snomed_hierarchy', args: { sctid: '73211009', direction: 'both' } },
  { nome: 'snomed_descriptions', args: { sctid: '73211009' } },
  { nome: 'snomed_ecl', args: { ecl: '<< 73211009' } },
  { nome: 'map_snomed_to_icd10', args: { sctid: '73211009' } },
];

let getHandler: (name: string) => ((args: Record<string, unknown>) => Promise<CallToolResult>) | undefined;
let toolCount = 0;

beforeAll(async () => {
  const { toolRegistry } = await import('./server-core.js');
  await import('./register.js');
  toolCount = toolRegistry.getTools().length;
  getHandler = (name) => toolRegistry.getHandler(name);
});

describe('provenance — wiring across the 6 SNOMED-gated tools (release gate)', () => {
  it('the gated surface registers all 39 tools', () => {
    expect(toolCount).toBe(39);
  });

  for (const caso of GATED) {
    it(`${caso.nome} attaches the provenance channel on the success path`, async () => {
      const handler = getHandler(caso.nome);
      expect(handler, `handler for ${caso.nome}`).toBeDefined();
      const result = await handler!(caso.args);

      expect(result.isError, `${caso.nome} errored`).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      const prov = structured.provenance as { source: string; license: string | null };
      expect(prov).toBeDefined();
      expect(Array.isArray(prov)).toBe(false);
      expect(prov.source).toContain('SNOMED');
      expect(prov.license).not.toBeNull();
      // The operator's Snowstorm base URL is the canonical source URL.
      const attribution = structured.attribution as string[];
      expect(attribution).toContain('https://snowstorm.example.test/snomed-ct');
    });
  }
});
