/**
 * Output contract, SNOMED-gated half: the 6 tools registered only under
 * ENABLE_SNOMED_TOOLS=true must obey their advertised `outputSchema` too
 * (37 = 31 default + these 6). Same reasoning as `output-contract.test.ts`;
 * the flag is read at module load, so this file sets the env FIRST and
 * pulls the registry via dynamic import — vitest isolates modules per file,
 * so the default-surface contract test is unaffected.
 *
 * `fetch` is mocked, NOT the client: the client's normalization (`|| ''` on
 * every optional Snowstorm field) is part of the contract being tested —
 * mocking the client out would test a shape the server never produces.
 * The payloads deliberately OMIT the optional upstream fields
 * (`effectiveTime`, `definitionStatus`, `moduleId`, `fsn`/`pt` terms), which
 * is the path that produces the empty/absent values.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import type { CallToolResult, Tool } from '@modelcontextprotocol/server';

process.env.ENABLE_SNOMED_TOOLS = 'true';
process.env.SNOMED_BASE_URL = 'https://snowstorm.example.test/snomed-ct';

const validator = new CfWorkerJsonSchemaValidator();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/** A Snowstorm concept item as sparse as the API gets: only the always-present keys. */
const sparseItem = {
  conceptId: '73211009',
  active: true,
  fsn: { term: 'Diabetes mellitus (disorder)', lang: 'en' },
  pt: { term: 'Diabetes mellitus', lang: 'en' },
  // effectiveTime / definitionStatus / moduleId absent — unversioned branch.
};

function mockSnowstorm(): void {
  global.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('/descriptions')) {
      return jsonResponse({
        conceptDescriptions: [
          {
            descriptionId: '123',
            term: 'Diabetes mellitus',
            active: true,
            // `typeId` is a core RF2 field and always present — the client is
            // the only place that copies it through WITHOUT a fallback, so an
            // upstream that ever omitted it would break the output contract.
            typeId: '900000000000003001',
            lang: 'en',
            // type / caseSignificance / acceptabilityMap absent.
          },
        ],
      });
    }
    if (url.includes('/parents') || url.includes('/children')) {
      return jsonResponse([sparseItem]);
    }
    if (/\/concepts\/\d+/.test(url)) {
      return jsonResponse(sparseItem);
    }
    if (url.includes('/concepts')) {
      return jsonResponse({ items: [sparseItem], total: 1 });
    }
    return jsonResponse({});
  }) as unknown as typeof fetch;
}

const CASES: Array<[string, string, Record<string, unknown>]> = [
  ['snomed_search', 'hits without definitionStatus/moduleId', { query: 'diabetes' }],
  ['snomed_concept', 'concept on an unversioned branch (no effectiveTime)', { sctid: '73211009' }],
  ['snomed_hierarchy', 'parents and children', { sctid: '73211009', direction: 'both' }],
  ['snomed_descriptions', 'descriptions without acceptability', { sctid: '73211009' }],
  ['snomed_ecl', 'ECL expression', { ecl: '<< 73211009' }],
  ['map_snomed_to_icd10', 'guidance only (null everywhere)', { sctid: '73211009' }],
];

let getHandler: (name: string) => ((args: Record<string, unknown>) => Promise<CallToolResult>) | undefined;
let getTool: (name: string) => Tool | undefined;
let toolCount = 0;

beforeEach(async () => {
  const { toolRegistry } = await import('./server-core.js');
  const { cache } = await import('./utils/cache.js');
  await import('./register.js');
  cache.flush();
  mockSnowstorm();
  toolCount = toolRegistry.getTools().length;
  getHandler = (name) => toolRegistry.getHandler(name);
  getTool = (name) => toolRegistry.getTools().find((t) => t.name === name);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('structuredContent obeys the advertised outputSchema (SNOMED-gated surface)', () => {
  it('the gated surface registers all 37 tools', () => {
    expect(toolCount).toBe(37);
  });

  it.each(CASES)('%s — %s', async (name, _path, args) => {
    const tool = getTool(name);
    expect(tool?.outputSchema, `tool ${name} has no outputSchema`).toBeDefined();

    const result = await getHandler(name)!(args);
    const text = (result.content?.[0] as { text?: string } | undefined)?.text;
    expect(result.isError, `${name} returned an error: ${text}`).toBeFalsy();
    expect(result.structuredContent, `${name} returned no structuredContent`).toBeDefined();

    // Validate what the CLIENT sees: `structuredContent` crosses the wire as
    // JSON, and JSON.stringify drops keys whose value is `undefined` — a
    // required field left undefined is a missing property on the wire.
    const onTheWire = JSON.parse(JSON.stringify(result.structuredContent)) as unknown;
    const verdict = validator.getValidator(tool!.outputSchema as never)(onTheWire);
    expect(verdict.valid, `${name}: ${verdict.errorMessage}`).toBe(true);
  });
});
