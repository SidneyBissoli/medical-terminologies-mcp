/**
 * Provenance release gate (contract v1.0): every DEFAULT tool (31 — the
 * 6 SNOMED-gated ones have their own env-gated twin in
 * provenance-wiring-snomed.test.ts) must attach the provenance channel on
 * its success path:
 *   - isError falsy;
 *   - structuredContent.provenance present (concise block, or array of
 *     blocks for the multi-source tools) with source/citation/license;
 *   - structuredContent.attribution: non-empty URL list;
 *   - _meta mirror under the com.sidneybissoli.medical namespaced keys;
 *   - the text footer appended to the Markdown channel.
 *
 * Clients are stubbed at the module boundary (vi.mock) — the gate pins the
 * WIRING of every handler, not the HTTP parsing (contract tests own that).
 * Bundled-dataset tools (cid10_*, map_icd10_to_icd11, terminology_*) run
 * against the real in-process clients.
 */

import { describe, it, expect, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';

// ---------------------------------------------------------------------------
// Client stubs (hoisted above the tool imports by vi.mock)
// ---------------------------------------------------------------------------

const icd11Entity = {
  '@id': 'http://id.who.int/icd/entity/119724091',
  code: '5A11',
  title: { '@value': 'Type 2 diabetes mellitus' },
  definition: { '@value': 'A metabolic disorder.' },
  browserUrl: 'https://icd.who.int/browse11',
};

vi.mock('./clients/who-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getWHOClient: () => ({
    search: async () => ({
      error: false,
      destinationEntities: [
        {
          id: 'http://id.who.int/icd/entity/119724091',
          theCode: '5A11',
          title: 'Type 2 diabetes mellitus',
          score: 0.9,
          isLeaf: true,
          matchingPVs: [],
        },
      ],
    }),
    lookup: async () => icd11Entity,
    getParents: async () => [icd11Entity],
    getChildren: async () => [icd11Entity],
    getChapters: async () => ({ child: ['http://id.who.int/icd/entity/1'] }),
    getEntity: async () => icd11Entity,
    getPostcoordination: async () => ({
      postcoordinationScale: [
        {
          axisName: 'severity',
          requiredPostcoordination: false,
          allowMultipleValues: 'false',
          scaleEntity: ['a', 'b'],
        },
      ],
    }),
  }),
}));

const loincItem = {
  LOINC_NUM: '2339-0',
  LONG_COMMON_NAME: 'Glucose [Mass/volume] in Blood',
  COMPONENT: 'Glucose',
  PROPERTY: 'MCnc',
  TIME_ASPCT: 'Pt',
  SYSTEM: 'Bld',
  SCALE_TYP: 'Qn',
  METHOD_TYP: '',
  CLASS: 'CHEM',
  STATUS: 'ACTIVE',
  SHORTNAME: 'Glucose Bld-mCnc',
};

vi.mock('./clients/nlm-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getNLMClient: () => ({
    searchLOINC: async () => ({ totalCount: 1, items: [loincItem] }),
    getLOINCDetails: async () => loincItem,
    getLOINCAnswers: async () => [{ sequence: 1, answerCode: 'LA1', answerString: 'Yes' }],
    getLOINCPanel: async () => ({
      loincNum: '24331-1',
      name: 'Lipid panel',
      items: [{ sequence: 1, loincNum: '2093-3', name: 'Cholesterol', required: true }],
    }),
  }),
}));

const rxDrug = { rxcui: '6809', name: 'metformin', synonym: '', tty: 'IN', language: 'ENG' };

vi.mock('./clients/rxnorm-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRxNormClient: () => ({
    searchDrugs: async () => ({ drugs: [rxDrug] }),
    getApproximateMatch: async () => [],
    getConcept: async () => ({
      ...rxDrug,
      suppress: 'N',
      umlscui: 'C0025598',
      status: 'Active',
      remappedTo: [],
    }),
    getRelatedConcepts: async () => [{ tty: 'BN', concepts: [rxDrug] }],
    getIngredients: async () => [
      { rxcui: '6809', name: 'metformin', tty: 'IN', isMultiple: false },
    ],
    getDrugClasses: async () => [
      { classId: 'A10BA', className: 'Biguanides', classType: 'ATC1-4', source: 'ATC' },
    ],
    getNDCs: async () => [{ ndc: '00093-1048-01' }],
    getRxcuiByNDC: async () => '6809',
    getATCByDrugName: async () => [
      { atc_code: 'A10BA02', atc_name: 'metformin', drug_name: 'metformin', tty: 'IN' },
    ],
    getATCByCode: async () => ({
      atc_code: 'A10BA',
      atc_name: 'Biguanides',
      atc_level_type: 'ATC4 (chemical subgroup)',
    }),
    getATCMembers: async () => [
      { source_atc_code: 'A10BA02', rxcui: '6809', name: 'metformin', tty: 'IN' },
    ],
  }),
}));

const meshDescriptor = {
  id: 'D003920',
  uri: 'http://id.nlm.nih.gov/mesh/D003920',
  label: 'Diabetes Mellitus',
  scopeNote: 'A heterogeneous group of disorders.',
  treeNumbers: [{ treeNumber: 'C18.452.394.750', uri: 'http://id.nlm.nih.gov/mesh/C18' }],
  concepts: [{ uri: 'http://id.nlm.nih.gov/mesh/M0006012', label: 'Diabetes Mellitus', isPreferred: true, terms: [] }],
  qualifiers: [{ id: 'Q000175', uri: 'http://id.nlm.nih.gov/mesh/Q000175', label: 'drug therapy' }],
};

vi.mock('./clients/mesh-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMeSHClient: () => ({
    searchDescriptors: async () => [
      { id: 'D003920', uri: 'http://id.nlm.nih.gov/mesh/D003920', label: 'Diabetes Mellitus' },
    ],
    getDescriptor: async () => meshDescriptor,
    getTreeNumbers: async () => meshDescriptor.treeNumbers,
    getAllowedQualifiers: async () => meshDescriptor.qualifiers,
  }),
}));

// Imported AFTER the mocks so the tool modules bind the stubbed clients.
import { toolRegistry } from './server-core.js';
import './register.js';
import { ATTRIBUTION_META_KEY, PROVENANCE_META_KEY } from './provenance.js';

// ---------------------------------------------------------------------------
// Cases: one call per tool, on its main success path
// ---------------------------------------------------------------------------

interface Caso {
  nome: string;
  args: Record<string, unknown>;
  /** Expected number of provenance blocks (undefined = single object). */
  multi?: number;
  /** Fragment expected inside the (first) block's source name. */
  sourceContains: string;
}

const casos: Caso[] = [
  // icd11 — WHO ICD-API
  { nome: 'icd11_search', args: { query: 'diabetes' }, sourceContains: 'WHO ICD-API' },
  { nome: 'icd11_lookup', args: { code: '5A11' }, sourceContains: 'WHO ICD-API' },
  { nome: 'icd11_hierarchy', args: { code: '5A11', direction: 'parents' }, sourceContains: 'WHO ICD-API' },
  { nome: 'icd11_chapters', args: {}, sourceContains: 'WHO ICD-API' },
  { nome: 'icd11_postcoordination', args: { code: '5A11' }, sourceContains: 'WHO ICD-API' },
  // loinc — Clinical Tables
  { nome: 'loinc_search', args: { query: 'glucose' }, sourceContains: 'Clinical Tables' },
  { nome: 'loinc_details', args: { loinc_num: '2339-0' }, sourceContains: 'Clinical Tables' },
  { nome: 'loinc_answers', args: { loinc_num: '2339-0' }, sourceContains: 'Clinical Tables' },
  { nome: 'loinc_panels', args: { loinc_num: '24331-1' }, sourceContains: 'Clinical Tables' },
  // rxnorm — RxNav
  { nome: 'rxnorm_search', args: { query: 'metformin' }, sourceContains: 'RxNav' },
  { nome: 'rxnorm_concept', args: { rxcui: '6809' }, sourceContains: 'RxNav' },
  { nome: 'rxnorm_ingredients', args: { rxcui: '6809' }, sourceContains: 'RxNav' },
  { nome: 'rxnorm_classes', args: { rxcui: '6809' }, sourceContains: 'RxNav' },
  { nome: 'rxnorm_ndc', args: { rxcui: '6809' }, sourceContains: 'RxNav' },
  // atc — RxClass
  { nome: 'atc_classify', args: { drug_name: 'metformin' }, sourceContains: 'RxClass' },
  { nome: 'atc_lookup', args: { atc_code: 'A10BA' }, sourceContains: 'RxClass' },
  { nome: 'atc_members', args: { atc_code: 'A10BA' }, sourceContains: 'RxClass' },
  // mesh
  { nome: 'mesh_search', args: { query: 'diabetes' }, sourceContains: 'MeSH' },
  { nome: 'mesh_descriptor', args: { mesh_id: 'D003920' }, sourceContains: 'MeSH' },
  { nome: 'mesh_tree', args: { mesh_id: 'D003920' }, sourceContains: 'MeSH' },
  { nome: 'mesh_qualifiers', args: { mesh_id: 'D003920' }, sourceContains: 'MeSH' },
  // cid10 — bundled DataSUS V2008
  { nome: 'cid10_search', args: { query: 'diabetes' }, sourceContains: 'DataSUS' },
  { nome: 'cid10_lookup', args: { code: 'E10' }, sourceContains: 'DataSUS' },
  { nome: 'cid10_chapters', args: {}, sourceContains: 'DataSUS' },
  { nome: 'cid10_chapter', args: { num: 4 }, sourceContains: 'DataSUS' },
  // crosswalk
  { nome: 'map_icd10_to_icd11', args: { icd10_code: 'E10' }, sourceContains: 'transition tables' },
  { nome: 'map_loinc_to_snomed', args: { loinc_code: '2339-0' }, sourceContains: 'Clinical Tables' },
  {
    nome: 'validate_codes',
    args: { codes: [{ code: 'E10', terminology: 'icd10' }, { code: 'A00', terminology: 'cid10' }] },
    multi: 2,
    sourceContains: 'transition tables',
  },
  {
    // SNOMED flag off in tests → 4 sources answer (icd11/loinc/rxnorm/mesh).
    nome: 'find_equivalent',
    args: { term: 'diabetes' },
    multi: 4,
    sourceContains: 'WHO ICD-API',
  },
  // versioning — server-maintained metadata
  { nome: 'terminology_versions', args: {}, sourceContains: 'server-maintained' },
  { nome: 'terminology_diff', args: { terminology: 'icd10' }, sourceContains: 'transition tables' },
];

interface ConciseBlockish {
  source: string;
  source_url: string;
  retrieved_at: string;
  citation: string;
  license: string | null;
  data_vintage: string | null;
}

async function executar(nome: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const handler = toolRegistry.getHandler(nome);
  expect(handler, `handler for ${nome}`).toBeDefined();
  return handler!(args);
}

describe('provenance — wiring across the 31 default tools (release gate)', () => {
  it('covers exactly the 31 default tools', () => {
    expect(toolRegistry.getTools()).toHaveLength(31);
    expect(new Set(casos.map((c) => c.nome)).size).toBe(31);
    const registered = new Set(toolRegistry.getTools().map((t) => t.name));
    for (const caso of casos) expect(registered.has(caso.nome), caso.nome).toBe(true);
  });

  for (const caso of casos) {
    it(`${caso.nome} attaches the provenance channel on the success path`, async () => {
      const result = await executar(caso.nome, caso.args);

      expect(result.isError, `${caso.nome} errored: ${JSON.stringify(result.content)}`).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toBeDefined();

      // Channel 1: structuredContent.provenance + attribution
      const prov = structured.provenance as ConciseBlockish | ConciseBlockish[];
      expect(prov).toBeDefined();
      const blocks = Array.isArray(prov) ? prov : [prov];
      if (caso.multi !== undefined) {
        expect(Array.isArray(prov), 'multi-source tools carry an ARRAY of blocks').toBe(true);
        expect(blocks).toHaveLength(caso.multi);
      } else {
        expect(Array.isArray(prov), 'single-source tools carry ONE block').toBe(false);
      }
      expect(blocks[0].source).toContain(caso.sourceContains);
      for (const block of blocks) {
        expect(block.source_url.length).toBeGreaterThan(0);
        expect(block.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(block.citation.length).toBeGreaterThan(20);
        expect(block.license, `${caso.nome} license`).not.toBeNull();
      }
      const attribution = structured.attribution as string[];
      expect(Array.isArray(attribution)).toBe(true);
      expect(attribution.length).toBeGreaterThan(0);

      // Channel 2: _meta mirror under the namespaced keys
      const meta = (result as { _meta?: Record<string, unknown> })._meta;
      expect(meta?.[PROVENANCE_META_KEY]).toEqual(prov);
      expect(meta?.[ATTRIBUTION_META_KEY]).toEqual(attribution);

      // Channel 3: text footer appended to the Markdown
      const text = (result.content as Array<{ type: string; text: string }>)
        .map((c) => c.text)
        .join('\n');
      expect(text).toContain('Source: ');
      expect(text).toContain('License: ');
    });
  }
});
