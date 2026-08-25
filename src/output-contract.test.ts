/**
 * Output contract: `structuredContent` obeys the advertised `outputSchema`.
 *
 * Why this file exists. The SDK v2 requires `structuredContent` on every
 * successful result of a tool that declares `outputSchema`, but it does NOT
 * validate the content against the schema — validation here is deliberately
 * permissive (see `register.ts`) so an upstream oddity never takes a whole
 * tool down. The MCP spec still requires conformance, and a client that
 * validates (the MCP Inspector does) rejects the ENTIRE response when it
 * doesn't hold.
 *
 * The hole is specific: handlers return `null` on purpose where the source
 * doesn't publish a field, and a schema that says `type: "string"` doesn't
 * admit `null`. The cases below deliberately exercise the null-producing
 * paths — absent optional parameters, sources that omit fields, empty
 * responses — because the happy path passes even with a dishonest schema.
 *
 * Network is never touched: `global.fetch` is mocked per URL, replaying the
 * captured fixtures in `src/__fixtures__/` where they exist.
 */

import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toolRegistry } from './server-core.js';
import { cache } from './utils/cache.js';
import './register.js';

const validator = new CfWorkerJsonSchemaValidator();
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fixture = (rel: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8')) as unknown;

const RELEASE = '2024-01';
const ICD_BASE = `https://id.who.int/icd/release/11/${RELEASE}/mms`;

/** An ICD-11 entity as the WHO API serves it, with the optional fields absent. */
function icdEntity(id: string, opts: { code?: string; withChildren?: boolean } = {}) {
  return {
    '@id': `http://id.who.int/icd/release/11/${RELEASE}/mms/${id}`,
    title: { '@value': `Entity ${id}` },
    ...(opts.code !== undefined ? { code: opts.code } : {}),
    classKind: 'category',
    ...(opts.withChildren
      ? {
          parent: [`http://id.who.int/icd/release/11/${RELEASE}/mms/111`],
          child: [`http://id.who.int/icd/release/11/${RELEASE}/mms/222`],
        }
      : {}),
  };
}

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

/**
 * One mock for every upstream. Fixtures are the captured live shapes; the
 * synthesized ones (WHO, which ships no fixtures because of OAuth) stay
 * deliberately sparse — the fields the source may omit are omitted.
 */
function mockUpstreams(): void {
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    void init;

    // ---- WHO OAuth ---------------------------------------------------
    if (url.includes('icdaccessmanagement.who.int')) {
      return jsonResponse({ access_token: 'test-token', token_type: 'Bearer', expires_in: 3600 });
    }

    // ---- WHO ICD-11 --------------------------------------------------
    if (url.includes('id.who.int')) {
      if (url.includes('/postcoordination')) {
        return jsonResponse({
          '@id': `${ICD_BASE}/1234/postcoordination`,
          postcoordinationScale: [
            {
              axisName: 'http://id.who.int/icd/schema/hasSeverity',
              requiredPostcoordination: 'false',
              allowMultipleValues: 'NotAllowed',
              // The source often omits `scaleEntity` — the null-producing path.
            },
          ],
        });
      }
      if (url.includes('/search')) {
        return jsonResponse({
          error: false,
          resultChopped: false,
          words: ['diabetes'],
          destinationEntities: [
            {
              id: `${ICD_BASE}/1234`,
              title: 'Type 2 diabetes mellitus',
              // `theCode` absent: foundation-only hits have no linearization code.
              stemId: `${ICD_BASE}/1234`,
              score: 0.72,
              isLeaf: true,
              matchingPVs: [],
            },
          ],
        });
      }
      if (url.includes('/codeinfo/')) {
        return jsonResponse({
          ...icdEntity('1234', { code: '5A11', withChildren: true }),
          stemId: `${ICD_BASE}/1234`,
        });
      }
      // The linearization root — chapters.
      if (/\/mms\/?(\?|$)/.test(url)) {
        return jsonResponse({
          '@id': ICD_BASE,
          title: { '@value': 'ICD-11 MMS' },
          child: [`${ICD_BASE}/455013390`, `${ICD_BASE}/1435254666`],
        });
      }
      // Any other entity fetch (parents, children, chapter entities).
      return jsonResponse(icdEntity(url.split('/').pop() ?? 'x'));
    }

    // ---- NLM Clinical Tables (LOINC) ---------------------------------
    if (url.includes('clinicaltables.nlm.nih.gov')) {
      if (url.includes('loinc_answers')) {
        // Verified upstream behavior: this endpoint 404s in production.
        return jsonResponse({ error: 'not found' }, 404);
      }
      if (url.includes('loinc_form_definitions')) {
        if (url.includes('99999-9')) return jsonResponse({ items: [] });
        return jsonResponse(fixture('nlm/loinc-panel-24331-1.json'));
      }
      if (url.includes('loinc_items')) {
        if (url.includes('sf=LOINC_NUM')) {
          if (url.includes('99999-9')) return jsonResponse(fixture('nlm/loinc-search-empty.json'));
          return jsonResponse(fixture('nlm/loinc-details-2339-0.json'));
        }
        if (url.includes('zzzznaoexiste')) return jsonResponse(fixture('nlm/loinc-search-empty.json'));
        return jsonResponse(fixture('nlm/loinc-search-glucose.json'));
      }
    }

    // ---- NLM RxNav (RxNorm + ATC/RxClass) ----------------------------
    if (url.includes('rxnav.nlm.nih.gov')) {
      if (url.includes('/rxclass/classMembers')) return jsonResponse(fixture('rxnorm/atc-members-A10BA.json'));
      if (url.includes('/rxclass/class/byId')) {
        if (url.includes('A99')) return jsonResponse(fixture('rxnorm/atc-byid-A10BA02-empty.json'));
        return jsonResponse(fixture('rxnorm/atc-byid-A10BA.json'));
      }
      if (url.includes('/rxclass/class/byDrugName')) {
        if (url.includes('zzzznaoexiste')) return jsonResponse({ rxclassDrugInfoList: {} });
        return jsonResponse(fixture('rxnorm/atc-bydrug-metformin.json'));
      }
      if (url.includes('/rxclass/class/byRxcui')) return jsonResponse(fixture('rxnorm/classes-byrxcui-6809.json'));
      if (url.includes('/rxcui.json') || url.includes('/drugs.json')) {
        if (url.includes('zzzznaoexiste')) return jsonResponse({ drugGroup: { name: null } });
        return jsonResponse(fixture('rxnorm/drugs-metformin.json'));
      }
      if (url.includes('/approximateTerm')) return jsonResponse(fixture('rxnorm/approximate-metfrmin.json'));
      if (url.includes('/allrelated') || url.includes('/related')) {
        return jsonResponse(fixture('rxnorm/related-6809-ingredients.json'));
      }
      if (url.includes('/ndcstatus')) return jsonResponse(fixture('rxnorm/ndcstatus.json'));
      if (url.includes('/ndcs.json')) return jsonResponse(fixture('rxnorm/ndcs-161.json'));
      if (url.includes('/status.json')) return jsonResponse(fixture('rxnorm/status-161.json'));
      if (url.includes('/properties.json')) {
        if (url.includes('/161/')) return jsonResponse(fixture('rxnorm/properties-161.json'));
        return jsonResponse(fixture('rxnorm/properties-6809.json'));
      }
      return jsonResponse({});
    }

    // ---- NLM MeSH ----------------------------------------------------
    if (url.includes('id.nlm.nih.gov/mesh')) {
      if (url.includes('/lookup/')) return jsonResponse(fixture('mesh/lookup-hypertension.json'));
      if (url.includes('D006973')) return jsonResponse(fixture('mesh/descriptor-D006973.json'));
      if (url.includes('D003920')) return jsonResponse(fixture('mesh/descriptor-D003920.json'));
      if (url.includes('M0010859')) return jsonResponse(fixture('mesh/concept-M0010859.json'));
      if (url.includes('Q000503')) return jsonResponse(fixture('mesh/qualifier-Q000503.json'));
      if (url.includes('T020937')) return jsonResponse(fixture('mesh/term-T020937.json'));
      if (url.includes('T020938')) return jsonResponse(fixture('mesh/term-T020938.json'));
      if (url.includes('C14.907.489')) return jsonResponse(fixture('mesh/treenumber-C14.907.489.json'));
      return jsonResponse({ '@id': url, label: { '@value': 'stub' } });
    }

    return jsonResponse({});
  }) as unknown as typeof fetch;
}

beforeAll(() => {
  process.env.WHO_CLIENT_ID = 'test-client';
  process.env.WHO_CLIENT_SECRET = 'test-secret';
});

beforeEach(() => {
  // The clients cache by key; a stale entry would hide the mocked path.
  cache.flush();
  mockUpstreams();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * One case per path that produces a null. The label says what the case is
 * there to cover, because "it ran without throwing" is not the point.
 */
const CASES: Array<[string, string, Record<string, unknown>]> = [
  ['icd11_search', 'hit without theCode (foundation-only)', { query: 'diabetes' }],
  ['icd11_lookup', 'entity with the optional fields absent', { code: '5A11' }],
  ['icd11_hierarchy', 'parents', { code: '5A11', direction: 'parents' }],
  ['icd11_hierarchy', 'children', { code: '5A11', direction: 'children' }],
  ['icd11_chapters', 'chapter list', {}],
  ['icd11_postcoordination', 'axis without scaleEntity (value_count null)', { code: '5A11' }],

  ['loinc_search', 'search with hits', { query: 'glucose' }],
  ['loinc_search', 'search without hits', { query: 'zzzznaoexiste' }],
  ['loinc_details', 'code whose fields the source leaves null', { loinc_num: '2339-0' }],
  ['loinc_answers', 'endpoint 404s upstream (empty list)', { loinc_num: '2339-0' }],
  ['loinc_panels', 'real panel', { loinc_num: '24331-1' }],
  ['loinc_panels', 'code that is not a panel', { loinc_num: '99999-9' }],

  ['rxnorm_search', 'drug with matches', { query: 'metformin' }],
  ['rxnorm_search', 'drug without matches', { query: 'zzzznaoexiste' }],
  ['rxnorm_concept', 'concept without include_related', { rxcui: '6809' }],
  ['rxnorm_concept', 'concept with related', { rxcui: '6809', include_related: true }],
  ['rxnorm_ingredients', 'ingredient fan-out', { rxcui: '6809' }],
  ['rxnorm_classes', 'classes by rxcui', { rxcui: '6809' }],
  ['rxnorm_ndc', 'by rxcui (ndc argument absent)', { rxcui: '161' }],
  ['rxnorm_ndc', 'by ndc (rxcui argument absent)', { ndc: '00093015001' }],

  ['mesh_search', 'search with hits', { query: 'hypertension' }],
  ['mesh_descriptor', 'descriptor fan-out', { mesh_id: 'D006973' }],
  ['mesh_tree', 'tree numbers', { mesh_id: 'D006973' }],
  ['mesh_qualifiers', 'allowable qualifiers', { mesh_id: 'D006973' }],

  ['map_icd10_to_icd11', 'code in the WHO table', { icd10_code: 'E11' }],
  ['map_icd10_to_icd11', 'code absent from the table (null mapping)', { icd10_code: 'ZZZ' }],
  ['map_loinc_to_snomed', 'guidance only (null everywhere)', { loinc_code: '2339-0' }],
  ['validate_codes', 'bundled branches', { codes: [{ code: 'E11', terminology: 'icd10' }, { code: 'A00', terminology: 'cid10' }] }],
  ['validate_codes', 'invalid code (title/active null)', { codes: [{ code: 'ZZZZ', terminology: 'icd10' }] }],
  ['find_equivalent', 'fan-out without source_terminology (echo null)', { term: 'glucose', target_terminologies: ['loinc', 'rxnorm'] }],
  ['find_equivalent', 'fan-out with source_terminology', { term: 'glucose', source_terminology: 'loinc', target_terminologies: ['rxnorm', 'mesh'] }],

  ['atc_classify', 'drug with ATC codes', { drug_name: 'metformin' }],
  ['atc_classify', 'drug without ATC codes', { drug_name: 'zzzznaoexiste' }],
  ['atc_lookup', 'level 1-4 code', { atc_code: 'A10BA' }],
  ['atc_lookup', 'code the endpoint does not resolve (name null)', { atc_code: 'A99' }],
  ['atc_members', 'class members', { atc_code: 'A10BA' }],

  ['cid10_search', 'bundled search', { query: 'diabetes' }],
  ['cid10_search', 'search without hits', { query: 'zzzznaoexiste' }],
  ['cid10_lookup', 'known code', { code: 'A00' }],
  ['cid10_lookup', 'well-formed code absent from the dataset', { code: 'U99' }],
  ['cid10_chapters', 'chapter list', {}],
  ['cid10_chapter', 'one chapter', { num: 1 }],

  ['terminology_versions', 'every terminology (filter null)', {}],
  ['terminology_versions', 'one terminology', { terminology: 'cid10' }],
  ['terminology_diff', 'diff without explicit versions', { terminology: 'icd10' }],
];

describe('structuredContent obeys the advertised outputSchema', () => {
  it.each(CASES)('%s — %s', async (name, _path, args) => {
    const tool = toolRegistry.getTools().find((t) => t.name === name);
    expect(tool?.outputSchema, `tool ${name} has no outputSchema`).toBeDefined();

    const handler = toolRegistry.getHandler(name);
    expect(handler, `tool ${name} has no handler`).toBeDefined();

    const result = await handler!(args);
    const text = (result.content?.[0] as { text?: string } | undefined)?.text;
    expect(result.isError, `${name} returned an error: ${text}`).toBeFalsy();
    expect(result.structuredContent, `${name} returned no structuredContent`).toBeDefined();

    // Validate what the CLIENT sees: `structuredContent` crosses the wire as
    // JSON, and JSON.stringify drops keys whose value is `undefined` — a
    // required field left undefined is a missing property on the wire.
    const onTheWire = JSON.parse(JSON.stringify(result.structuredContent)) as unknown;
    const validate = validator.getValidator(tool!.outputSchema as never);
    const verdict = validate(onTheWire);

    expect(verdict.valid, `${name}: ${verdict.errorMessage}`).toBe(true);
  });

  /**
   * A test that cannot fail is worth nothing. This one takes a REAL result
   * and validates it against a deliberately dishonest schema — the exact
   * lie this file exists to catch (a nullable field advertised as a plain
   * string) — and asserts the validator rejects it.
   */
  it('rejects a dishonest schema (proof the gate can fail)', async () => {
    const result = await toolRegistry.getHandler('loinc_details')!({ loinc_num: '2339-0' });
    const honest = toolRegistry.getTools().find((t) => t.name === 'loinc_details')!.outputSchema!;

    expect(validator.getValidator(honest as never)(result.structuredContent).valid).toBe(true);

    const dishonest = JSON.parse(JSON.stringify(honest)) as {
      properties: { provenance: { properties: Record<string, unknown> } };
    };
    // `data_vintage` is null for LOINC (the source exposes no release id).
    dishonest.properties.provenance.properties.data_vintage = { type: 'string' };

    const verdict = validator.getValidator(dishonest as never)(result.structuredContent);
    expect(verdict.valid).toBe(false);
    expect(verdict.errorMessage).toContain('data_vintage');
  });

  it('every registered tool declares an outputSchema', () => {
    for (const tool of toolRegistry.getTools()) {
      expect(tool.outputSchema, `${tool.name} has no outputSchema`).toBeDefined();
    }
    expect(toolRegistry.getTools()).toHaveLength(31);
  });

  it('every registered tool is covered by at least one case', () => {
    const covered = new Set(CASES.map(([name]) => name));
    const missing = toolRegistry
      .getTools()
      .map((t) => t.name)
      .filter((name) => !covered.has(name));
    expect(missing, `tools with no output-contract case: ${missing.join(', ')}`).toEqual([]);
  });
});
