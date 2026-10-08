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
 * Client-shaped since 2026-10-04 (a reader's idea,
 * https://dev.to/arhancanli/comment/3g4i4). The test no longer validates the
 * registry's `structuredContent` against `toolRegistry`'s internal definitions
 * with a validator we picked. It drives the REAL server (`createServer`, the
 * factory both transports use) through the SDK's own `Client`: `tools/list`,
 * then `tools/call`, and the Client rejects the result against the LISTED
 * `outputSchema` — so the test fails the way a user's session would. The
 * circuit is `@sbissoli/mcp-surface/cliente`, shared by the portfolio's seven
 * servers; it round-trips every server message through JSON, as the wire does
 * (a required field left `undefined` vanishes there and reads as missing).
 *
 * Network is never touched: `global.fetch` is mocked per URL, replaying the
 * captured fixtures in `src/__fixtures__/` where they exist.
 */

import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { chamarComoCliente, conectarComoCliente, controlesNegativos } from '@sbissoli/mcp-surface/cliente';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from './register.js';
import { cache } from './utils/cache.js';

/** One call on the client's path, over a connection of its own. */
async function callAsClient(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const client: Client = await conectarComoCliente(createServer());
  try {
    const r = await chamarComoCliente(client, name, args);
    expect(r.structuredContent, `${name} returned no structuredContent`).toBeDefined();
    return r.structuredContent as Record<string, unknown>;
  } finally {
    await client.close();
  }
}

/** The tools as a client sees them: the `tools/list` of the real server. */
async function listedTools() {
  const client = await conectarComoCliente(createServer());
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

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
        // The live shape (2026-09-03): a resolver record — no title, no
        // parents — pointing at the entity through `stemId`.
        return jsonResponse({
          '@context': 'http://id.who.int/icd/contexts/contextForCodeInfo.json',
          '@id': `${ICD_BASE}/codeinfo/5A11`,
          stemId: `${ICD_BASE}/1234`,
          code: '5A11',
        });
      }
      if (url.endsWith('/mms/1234')) {
        return jsonResponse(icdEntity('1234', { code: '5A11', withChildren: true }));
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
        // Live behavior (2026-10-03): 200 with the list for question codes,
        // 404 for codes without one (and for unknown codes).
        if (url.includes('72166-2')) return jsonResponse(fixture('nlm/loinc-answers-72166-2.json'));
        if (url.includes('44250-9')) return jsonResponse(fixture('nlm/loinc-answers-44250-9-scored.json'));
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
      if (url.includes('/historystatus.json')) return jsonResponse(fixture('rxnorm/historystatus-161.json'));
      if (url.includes('/properties.json')) {
        // The REAL not-found shape of RxNav: 200 with `{}` (live capture 2026-09-28).
        if (url.includes('/999999999/')) return jsonResponse(fixture('rxnorm/properties-999999999-nonexistent.json'));
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
  ['loinc_answers', 'valid code without an answer list (empty list)', { loinc_num: '2339-0' }],
  ['loinc_answers', 'answer list without scores (score null)', { loinc_num: '72166-2' }],
  ['loinc_answers', 'scored instrument (score numeric)', { loinc_num: '44250-9' }],
  ['loinc_panels', 'real panel', { loinc_num: '24331-1' }],
  ['loinc_panels', 'code that is not a panel', { loinc_num: '99999-9' }],

  ['rxnorm_search', 'drug with matches', { query: 'metformin' }],
  ['rxnorm_search', 'drug without matches', { query: 'zzzznaoexiste' }],
  ['rxnorm_concept', 'concept without include_related', { rxcui: '6809' }],
  ['rxnorm_concept', 'concept with related', { rxcui: '6809', include_related: true }],
  ['rxnorm_concept', 'rxcui RxNorm does not have (found:false, concept fields null)', { rxcui: '999999999' }],
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
  ['validate_codes', 'bundled branches', { codes: [{ code: 'E11', terminology: 'icd10' }, { code: 'A00', terminology: 'cid10' }] }],
  ['validate_codes', 'invalid code (title/active null)', { codes: [{ code: 'ZZZZ', terminology: 'icd10' }] }],
  ['find_equivalent', 'fan-out without source_terminology (echo null)', { term: 'glucose', target_terminologies: ['loinc', 'rxnorm'] }],
  ['find_equivalent', 'fan-out with source_terminology', { term: 'glucose', source_terminology: 'loinc', target_terminologies: ['rxnorm', 'mesh'] }],
  ['harmonize_terms', 'one term per domain (atc array on drug, null elsewhere; uri null off ICD-11)', {
    terms: [
      { term: 'type 2 diabetes mellitus', domain: 'diagnosis' },
      { term: 'metformin', domain: 'drug' },
      { term: 'glucose', domain: 'lab' },
    ],
  }],
  ['harmonize_terms', 'terms without candidates (match_type null, empty candidates) + duplicate', {
    terms: [
      { term: 'zzzznaoexiste', domain: 'lab' },
      { term: 'zzzznaoexiste', domain: 'lab' },
      { term: 'zzzznaoexiste', domain: 'drug' },
    ],
    max_candidates: 1,
  }],

  ['atc_classify', 'drug with ATC codes', { drug_name: 'metformin' }],
  ['atc_classify', 'drug without ATC codes', { drug_name: 'zzzznaoexiste' }],
  ['atc_lookup', 'level 1-4 code', { atc_code: 'A10BA' }],
  ['atc_lookup', 'code the endpoint does not resolve (name null)', { atc_code: 'A99' }],
  ['atc_members', 'class members', { atc_code: 'A10BA' }],

  ['cid10_search', 'bundled search', { query: 'diabetes' }],
  ['cid10_search', 'search without hits', { query: 'zzzznaoexiste' }],
  ['cid10_search', 'everyday word translated (vocabulary_notes present)', { query: 'câncer de mama' }],
  ['cid10_lookup', 'known code', { code: 'A00' }],
  ['cid10_lookup', 'well-formed code absent from the dataset', { code: 'U99' }],
  ['cid10_chapters', 'chapter list', {}],
  ['cid10_chapter', 'one chapter', { num: 1 }],

  ['terminology_versions', 'every terminology (filter null)', {}],
  ['terminology_versions', 'one terminology', { terminology: 'cid10' }],
  ['terminology_diff', 'diff without explicit versions', { terminology: 'icd10' }],

  // Deep Research contract (`search`/`fetch`, served like the rest).
  // `search` fans out to the mocked upstreams above and ranks with the local
  // CID-10 index; `fetch` renders through each terminology's lookup tool.
  ['search', 'query with hits in every source', { query: 'diabetes' }],
  ['search', 'query nothing matches (empty results, provenance still multi)', { query: 'zzzzqqqq' }],
  ['fetch', 'CID-10 subcategory', { id: 'cid10:A00.0' }],
  ['fetch', 'CID-10 chapter', { id: 'cid10-chapter:1' }],
  ['fetch', 'ICD-11 entity', { id: 'icd11:5A11' }],
  ['fetch', 'LOINC code', { id: 'loinc:2339-0' }],
  ['fetch', 'RxNorm concept', { id: 'rxnorm:6809' }],
  ['fetch', 'MeSH descriptor', { id: 'mesh:D003920' }],
  ['fetch', 'terminology version record', { id: 'version:loinc' }],
];

describe('structuredContent obeys the advertised outputSchema', () => {
  // The Client validates against the schema it cached from `tools/list` and
  // throws when the result does not obey it; `chamarComoCliente` also fails
  // on `isError`. Nothing else to assert: the Client is the validator.
  it.each(CASES)('%s — %s', async (name, _path, args) => {
    await callAsClient(name, args);
  });

  it('every listed tool declares an outputSchema', async () => {
    const tools = await listedTools();
    for (const tool of tools) {
      expect(tool.outputSchema, `${tool.name} has no outputSchema`).toBeDefined();
    }
    expect(tools).toHaveLength(33);
  });

  it('every listed tool is covered by at least one case', async () => {
    const covered = new Set(CASES.map(([name]) => name));
    const missing = (await listedTools()).map((t) => t.name).filter((name) => !covered.has(name));
    expect(missing, `tools with no output-contract case: ${missing.join(', ')}`).toEqual([]);
  });
});

// ==================== negative control, on the client's path ====================
//
// A test that cannot fail is worth nothing. Here the server answers correctly
// and the result is broken ON THE WIRE, between server and client — as it
// would arrive from a defective server. Every break must make the call fail.
// The breaks are derived from the LISTED schema (structuredContent absent,
// each required field absent, a type swapped); the extra field is this
// server's own break, measured: the listed top level of `loinc_details` is
// sealed (`additionalProperties: false`). The last verdict is the trap: without
// `tools/list` first the Client does not validate — if the SDK ever changes
// that, the verdict says so.
//
// This replaces the earlier "dishonest schema" proof, which fed a hand-edited
// schema to a validator we picked. The proof that the CLIENT catches a lie in
// the listed schema was made by mutation (2026-10-04): announcing LOINC's
// `external_copyright_notice` (null when the term carries none) as a plain
// string made the Client itself reject `loinc_details` and `loinc_search`
// here ("Structured content does not match the tool's output schema").

describe("the client's validator rejects a result broken on the wire", () => {
  it('loinc_details: every break is rejected, and the trap holds', async () => {
    const vs = await controlesNegativos(() => createServer(), 'loinc_details', { loinc_num: '2339-0' }, [
      {
        descricao: 'field the sealed schema forbids (intruder)',
        adulterar: (r) => {
          if (r.structuredContent) r.structuredContent.intruder = 1;
        },
      },
    ]);
    expect(vs.length).toBeGreaterThanOrEqual(4);
    for (const v of vs) expect(v.obtido, `${v.descricao}: ${v.mensagem ?? ''}`).toBe(v.esperado);
    // 30 verdicts, each over a fresh server + Client that compiles the listed
    // schema again: 2-4 s alone, more under the full suite's load — the
    // default 5 s timeout was already at the edge before contract v1.2 added
    // the optional `field_sources` node to the provenance schema.
  }, 30_000);
});

// ==================== contract 1.3, step one: the listed schema accepts it ====================
//
// The server still emits 1.2 (the four 1.3 keys never reach the wire), but the
// LISTED schema must already accept a full 1.3 block — that is step one of the
// two-step rollout: connectors cache the schema before the wire changes. The
// block is injected on the wire, between server and client, and the Client
// validates it against the schema it got from `tools/list`.

const FULL_13 = {
  notices: ['A notice the source publishes, verbatim.'],
  derived: true,
  derivation_note: 'What the server computed.',
  revision: { status: 'current', note: 'Released annually.' },
};

function injectInto(r: { structuredContent?: Record<string, unknown> }, extra: Record<string, unknown>): void {
  const prov = r.structuredContent?.provenance;
  const blocks = Array.isArray(prov) ? prov : [prov];
  for (const b of blocks) Object.assign(b as Record<string, unknown>, extra);
}

async function callWithInjected(name: string, args: Record<string, unknown>, extra: Record<string, unknown>) {
  const client = await conectarComoCliente(createServer(), { adulterar: (r) => injectInto(r, extra) });
  try {
    return await chamarComoCliente(client, name, args);
  } finally {
    await client.close();
  }
}

describe('the listed schema accepts a contract 1.3 block (step one of 1.3)', () => {
  it('declares notices/derived/derivation_note/revision, none of them required', async () => {
    const tool = (await listedTools()).find((t) => t.name === 'cid10_lookup');
    const prov = (tool?.outputSchema as { properties: Record<string, { properties: object; required: string[] }> })
      .properties.provenance;
    for (const key of ['notices', 'derived', 'derivation_note', 'revision']) {
      expect(Object.keys(prov.properties)).toContain(key);
      expect(prov.required).not.toContain(key);
    }
  });

  it('single-source tool: a block with the four 1.3 keys passes the Client', async () => {
    const r = await callWithInjected('cid10_lookup', { code: 'A00' }, FULL_13);
    expect((r.structuredContent as { provenance: { revision: unknown } }).provenance.revision).toEqual(FULL_13.revision);
  });

  it('multi-source tool: every block with the four 1.3 keys passes the Client', async () => {
    await callWithInjected(
      'validate_codes',
      { codes: [{ code: 'E11', terminology: 'icd10' }, { code: 'A00', terminology: 'cid10' }] },
      FULL_13,
    );
  });

  it('negative control: a status outside the closed vocabulary is rejected', async () => {
    await expect(
      callWithInjected('cid10_lookup', { code: 'A00' }, { revision: { status: 'maybe', note: null } }),
    ).rejects.toThrow();
  });
});
