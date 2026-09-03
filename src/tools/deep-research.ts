/**
 * `search` / `fetch` — the ChatGPT Deep Research contract (OpenAI), over the
 * seven terminologies. The contract, the envelope, the descriptions and the
 * ranking index live in `@sbissoli/mcp-search` (portfolio package); this
 * module is the medical adapter: what can be found and how a document reads.
 *
 * Why these two tools exist: ChatGPT deep research, company knowledge and the
 * research workflows of the Responses API only use an MCP server that exposes
 * exactly `search` and `fetch` — the terminology tools, however rich, are
 * invisible to them. They are the ONLY tools without a terminology prefix
 * (names fixed by OpenAI; `src/evals/fixtures.test.ts` carries the allowlist).
 *
 * Registration goes THROUGH `toolRegistry`, like every other tool: the
 * package's factory is pointed at a capturing sink, its two registrations are
 * converted to this server's shape (JSON Schemas via `buildInputSchema` /
 * `buildOutputSchema`, Zod validation inside the handler via
 * `handleToolError`) and registered below. So the `handle` wrapper of
 * `register.ts` covers them (fetch-meta collector for `retrieved_at`,
 * StatsCounter, usage hook) and every registry-derived gate — tool counts in
 * the public texts, provenance wiring, output contract, evals catalog, CI
 * call-site count — sees them without a special case.
 *
 * The corpus:
 *  - local, indexed once per process (bundled data, frozen): every CID-10
 *    category and subcategory (`cid10:<code>`, ~14.5k docs, DataSUS V2008),
 *    the 22 CID-10 chapters (`cid10-chapter:<num>`) and the eight terminology
 *    version records (`version:<terminology>`);
 *  - live, one fan-out per `search` like `find_equivalent` does: ICD-11
 *    (`icd11:<code>`), LOINC (`loinc:<num>`), RxNorm (`rxnorm:<rxcui>`) and
 *    MeSH (`mesh:<D…>`), each best-effort — a source that fails (WHO
 *    credentials absent on a local install, upstream down) contributes no
 *    result and no provenance block, exactly as in `find_equivalent`.
 *  SNOMED is out: the public browser retired (HTTP 410 on 2026-09-02) and
 *  the contract needs a public URL to cite; ATC is reachable through RxNorm.
 *
 * Ranking across sources reuses the server's `lexicalScore` (the method of
 * `find_equivalent`, documented by RANKING_METHOD_NOTE): one global order,
 * ties by source order then upstream order — deterministic for identical
 * responses. `fetch` calls the real lookup handler of the id's terminology
 * and reuses its Markdown as `text` and its provenance channels as the
 * envelope extras, so the provenance gate covers these two the same way.
 *
 * `url` is always the canonical PUBLIC page of the entity (never an API
 * URL): ChatGPT only creates a citation when `url` is non-empty. Patterns
 * verified live on 2026-09-02 (WHO ICD-10/ICD-11 browsers, loinc.org, RxNav,
 * MeSH Browser).
 */

import type { CallToolResult, McpServer, Tool } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  DEEP_RESEARCH_TOOLS,
  contractSchemas,
  createIndex,
  registerDeepResearchTools,
  type DeepResearchToolName,
  type EnvelopeExtras,
  type FetchDocument,
  type FetchReply,
  type IndexEntry,
  type SearchIndex,
  type SearchReply,
  type SearchResult,
} from '@sbissoli/mcp-search';
import { toolRegistry, type ToolHandler } from '../server-core.js';
import { getCID10Client, type CID10Chapter, type CID10SearchHit } from '../clients/cid10-client.js';
import { getWHOClient } from '../clients/who-client.js';
import { getNLMClient } from '../clients/nlm-client.js';
import { getRxNormClient } from '../clients/rxnorm-client.js';
import { getMeSHClient } from '../clients/mesh-client.js';
import { attributionList, renderConcise } from '@sbissoli/mcp-provenance';
import {
  ATTRIBUTION_META_KEY,
  PROVENANCE_META_KEY,
  medicalProvenance,
  withProvenance,
  withProvenanceMulti,
  type MedicalSourceKey,
  type Provenance,
} from '../provenance.js';
import { lexicalScore, RANKING_METHOD_NOTE } from '../utils/lexical-score.js';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
} from '../utils/zod-schema.js';
import { createToolLogger } from '../utils/logger.js';
import { buildMetadata, type TerminologyMeta } from './versioning.js';

const log = createToolLogger('deep-research');

export { DEEP_RESEARCH_TOOLS };

/** Results per `search` call (the contract has no paging; ten is what the examples show). */
export const DEEP_RESEARCH_LIMIT = 10;

/**
 * Candidates taken from each source before the global ranking. Equal to the
 * answer size on purpose: a query that only one terminology can answer
 * ("glucose blood test" → LOINC) still fills the list from that source.
 */
export const PER_SOURCE_LIMIT = DEEP_RESEARCH_LIMIT;

/** Prefixes of the document ids, one per kind of document. */
export const DEEP_RESEARCH_ID_PREFIXES = {
  cid10: 'cid10:',
  cid10Chapter: 'cid10-chapter:',
  icd11: 'icd11:',
  loinc: 'loinc:',
  rxnorm: 'rxnorm:',
  mesh: 'mesh:',
  version: 'version:',
} as const;

type DocKind = keyof typeof DEEP_RESEARCH_ID_PREFIXES;

/** Kinds served from the bundled data (indexed in-process; every id is known). */
const LOCAL_KINDS: DocKind[] = ['cid10', 'cid10Chapter', 'version'];

/** Source order — the tie-break of the global ranking and the order of the provenance blocks. */
const SOURCE_ORDER: DocKind[] = ['cid10', 'cid10Chapter', 'icd11', 'loinc', 'rxnorm', 'mesh', 'version'];

/** Provenance preset of each kind (the same key the terminology's own tools use). */
const SOURCE_KEY: Record<DocKind, MedicalSourceKey> = {
  cid10: 'DATASUS_CID10',
  cid10Chapter: 'DATASUS_CID10',
  icd11: 'WHO_ICD_API',
  loinc: 'CLINICALTABLES_LOINC',
  rxnorm: 'NLM_RXNAV',
  mesh: 'NLM_MESH',
  version: 'SERVER_METADATA',
};

/** The registry tool that renders the document of each kind, and its argument name. */
const DETAIL_TOOL: Record<DocKind, { tool: string; arg: string }> = {
  cid10: { tool: 'cid10_lookup', arg: 'code' },
  cid10Chapter: { tool: 'cid10_chapter', arg: 'num' },
  icd11: { tool: 'icd11_lookup', arg: 'code' },
  loinc: { tool: 'loinc_details', arg: 'loinc_num' },
  rxnorm: { tool: 'rxnorm_concept', arg: 'rxcui' },
  mesh: { tool: 'mesh_descriptor', arg: 'mesh_id' },
  version: { tool: 'terminology_versions', arg: 'terminology' },
};

// ---------------------------------------------------------------------------
// Canonical public URLs (what ChatGPT cites)
// ---------------------------------------------------------------------------

export const ICD10_BROWSER_URL = 'https://icd.who.int/browse10/2019/en#/';
export const ICD11_BROWSER_URL = 'https://icd.who.int/browse/';
export const LOINC_URL = 'https://loinc.org/';
export const RXNAV_URL = 'https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=';
export const MESH_BROWSER_URL = 'https://meshb.nlm.nih.gov/record/ui?ui=';

const ROMAN = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI',
  'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII',
];

/** WHO ICD-10 browser: a category/subcategory by dotted code ("A00.0"), a chapter by roman numeral. */
export function urlIcd10(code: string): string {
  return `${ICD10_BROWSER_URL}${code}`;
}

export function urlIcd10Chapter(num: number): string {
  return urlIcd10(ROMAN[num - 1] ?? String(num));
}

/**
 * WHO ICD-11 browser, from the entity URI the API returns
 * (`http://id.who.int/icd/release/11/<release>/mms/<entity>` — release
 * URIs carry the release; foundation URIs (`/icd/entity/<id>`) do not and
 * open on the latest release). Returns null when the URI has no entity id.
 */
export function urlIcd11(uri: string): string | null {
  // The entity is what follows `/mms/` (release URI) or `/entity/` (foundation
  // URI): a numeric id, optionally with the `/other` or `/unspecified` residual.
  const entity = uri.match(/\/(?:mms|entity)\/(\d+(?:\/(?:other|unspecified))?)$/)?.[1];
  if (!entity) return null;
  const release = uri.match(/\/release\/11\/([^/]+)\//)?.[1] ?? 'latest-release';
  return `${ICD11_BROWSER_URL}${release}/mms/en#${entity}`;
}

export function urlLoinc(num: string): string {
  return `${LOINC_URL}${num}`;
}

export function urlRxNorm(rxcui: string): string {
  return `${RXNAV_URL}${rxcui}`;
}

export function urlMesh(id: string): string {
  return `${MESH_BROWSER_URL}${id}`;
}

// ---------------------------------------------------------------------------
// The local index (bundled data — built once per process)
// ---------------------------------------------------------------------------

/** An index entry plus what the ranking and `fetch` need beyond the contract. */
interface LocalDoc extends IndexEntry {
  kind: DocKind;
  /** Bare label (no code prefix) — what `lexicalScore` compares against the query. */
  label: string;
}

export function cid10Entries(hits: CID10SearchHit[]): LocalDoc[] {
  return hits.map((h) => ({
    kind: 'cid10',
    id: `${DEEP_RESEARCH_ID_PREFIXES.cid10}${h.display}`,
    title: `CID-10 ${h.display} — ${h.title}`,
    label: h.title,
    url: urlIcd10(h.display),
    keywords: [h.code, h.display, h.level === 'category' ? 'categoria' : 'subcategoria'],
    text: h.title_short !== h.title ? h.title_short : undefined,
  }));
}

export function cid10ChapterEntries(chapters: CID10Chapter[]): LocalDoc[] {
  return chapters.map((c) => ({
    kind: 'cid10Chapter',
    id: `${DEEP_RESEARCH_ID_PREFIXES.cid10Chapter}${c.num}`,
    title: `CID-10 — Capítulo ${ROMAN[c.num - 1] ?? c.num}: ${c.title}`,
    label: c.title,
    url: urlIcd10Chapter(c.num),
    keywords: ['capítulo', `${c.code_start}-${c.code_end}`, c.code_start, c.code_end],
    text: c.title_short,
  }));
}

export function versionEntries(metas: TerminologyMeta[]): LocalDoc[] {
  return metas.map((m) => ({
    kind: 'version',
    id: `${DEEP_RESEARCH_ID_PREFIXES.version}${m.code}`,
    title: `${m.name} — ${m.full_name} (version ${m.current_version})`,
    label: `${m.name} ${m.full_name}`,
    url: m.source_url,
    keywords: [m.code, m.publisher, 'version', 'release', m.current_version],
    text: m.notes ?? undefined,
  }));
}

interface LocalIndex {
  index: SearchIndex;
  byId: Map<string, LocalDoc>;
}

let localIndex: LocalIndex | null = null;

function buildLocalIndex(): LocalIndex {
  const cid10 = getCID10Client();
  // Order matters for ties: categories before subcategories, then chapters,
  // then the version records. The DataSUS subcategory table repeats the 263
  // categories that have no subdivision (same 3-char code, e.g. A33) — one
  // document per code, the category entry wins.
  const byId = new Map<string, LocalDoc>();
  for (const doc of [
    ...cid10Entries([...cid10.listCategories(), ...cid10.listSubcategories()]),
    ...cid10ChapterEntries(cid10.listChapters()),
    ...versionEntries(buildMetadata()),
  ]) {
    if (!byId.has(doc.id)) byId.set(doc.id, doc);
  }
  return { index: createIndex([...byId.values()]), byId };
}

/** The local index, built on first use (~14.5k docs from bundled, frozen data). */
export function getLocalIndex(): LocalIndex {
  if (!localIndex) localIndex = buildLocalIndex();
  return localIndex;
}

/** Drops the index (tests). */
export function resetLocalIndex(): void {
  localIndex = null;
}

// ---------------------------------------------------------------------------
// search — local index + live fan-out, one global ranking
// ---------------------------------------------------------------------------

interface Candidate {
  kind: DocKind;
  upstreamIndex: number;
  result: SearchResult;
  label: string;
}

/** One source of the fan-out: what it found, or why it is out of the answer. */
interface SourceOutcome {
  kind: DocKind;
  candidates: Candidate[];
  error: string | null;
}

function ok(kind: DocKind, candidates: Candidate[]): SourceOutcome {
  return { kind, candidates, error: null };
}

function failed(kind: DocKind, e: unknown): SourceOutcome {
  const error = e instanceof Error ? e.message : String(e);
  log.debug({ source: kind, error }, 'Deep Research search: source skipped');
  return { kind, candidates: [], error };
}

function candidate(kind: DocKind, upstreamIndex: number, result: SearchResult, label: string): Candidate {
  return { kind, upstreamIndex, result, label };
}

function searchLocal(query: string): SourceOutcome[] {
  const { index, byId } = getLocalIndex();
  const hits = index.search(query, { limit: DEEP_RESEARCH_LIMIT });
  const perKind = new Map<DocKind, Candidate[]>();
  for (const hit of hits) {
    const doc = byId.get(hit.id);
    if (!doc) continue;
    const list = perKind.get(doc.kind) ?? [];
    if (list.length >= PER_SOURCE_LIMIT) continue;
    list.push(candidate(doc.kind, list.length, hit, doc.label));
    perKind.set(doc.kind, list);
  }
  // Local sources always "answer" (bundled data cannot fail): a block each,
  // even when nothing matched — same as a live source that returned [].
  return LOCAL_KINDS.map((kind) => ok(kind, perKind.get(kind) ?? []));
}

async function searchIcd11(query: string): Promise<SourceOutcome> {
  try {
    const response = await getWHOClient().search(query, 'en', PER_SOURCE_LIMIT);
    const out: Candidate[] = [];
    for (const r of response.destinationEntities ?? []) {
      // Foundation-only hits have no linearization code — `icd11_lookup`
      // needs one, and so does the reader.
      if (!r.theCode || !r.id) continue;
      const url = urlIcd11(r.id);
      if (!url) continue;
      const title = r.title ?? r.theCode;
      out.push(
        candidate(
          'icd11',
          out.length,
          { id: `${DEEP_RESEARCH_ID_PREFIXES.icd11}${r.theCode}`, title: `ICD-11 ${r.theCode} — ${title}`, url },
          title,
        ),
      );
      if (out.length >= PER_SOURCE_LIMIT) break;
    }
    return ok('icd11', out);
  } catch (e) {
    return failed('icd11', e);
  }
}

async function searchLoinc(query: string): Promise<SourceOutcome> {
  try {
    const response = await getNLMClient().searchLOINC(query, PER_SOURCE_LIMIT);
    const out = (response.items ?? []).slice(0, PER_SOURCE_LIMIT).map((r, i) =>
      candidate(
        'loinc',
        i,
        {
          id: `${DEEP_RESEARCH_ID_PREFIXES.loinc}${r.LOINC_NUM}`,
          title: `LOINC ${r.LOINC_NUM} — ${r.LONG_COMMON_NAME}`,
          url: urlLoinc(r.LOINC_NUM),
        },
        r.LONG_COMMON_NAME,
      ),
    );
    return ok('loinc', out);
  } catch (e) {
    return failed('loinc', e);
  }
}

async function searchRxNorm(query: string): Promise<SourceOutcome> {
  try {
    const response = await getRxNormClient().searchDrugs(query);
    const out = response.drugs.slice(0, PER_SOURCE_LIMIT).map((r, i) =>
      candidate(
        'rxnorm',
        i,
        {
          id: `${DEEP_RESEARCH_ID_PREFIXES.rxnorm}${r.rxcui}`,
          title: `RxNorm ${r.rxcui} — ${r.name}`,
          url: urlRxNorm(r.rxcui),
        },
        r.name,
      ),
    );
    return ok('rxnorm', out);
  } catch (e) {
    return failed('rxnorm', e);
  }
}

async function searchMesh(query: string): Promise<SourceOutcome> {
  try {
    const results = await getMeSHClient().searchDescriptors(query, 'contains', PER_SOURCE_LIMIT);
    const out = results.slice(0, PER_SOURCE_LIMIT).map((r, i) =>
      candidate(
        'mesh',
        i,
        { id: `${DEEP_RESEARCH_ID_PREFIXES.mesh}${r.id}`, title: `MeSH ${r.id} — ${r.label}`, url: urlMesh(r.id) },
        r.label,
      ),
    );
    return ok('mesh', out);
  } catch (e) {
    return failed('mesh', e);
  }
}

/**
 * Global order: lexical score desc, then source order, then upstream order.
 * The score is the better of the bare label (natural-language queries) and
 * the full title, which carries the terminology and the code (a query that
 * IS a code — "E10", "2339-0" — shares no word with any label). A candidate
 * that scores 0 on both is dropped: the local index also matches by prefix,
 * and "test" matching "testículos" is not a document the reader asked for.
 */
export function rankCandidates(query: string, outcomes: SourceOutcome[]): SearchResult[] {
  const scored = outcomes
    .flatMap((o) =>
      o.candidates.map((c) => ({
        c,
        score: Math.max(lexicalScore(query, c.label), lexicalScore(query, c.result.title)),
      })),
    )
    .filter((s) => s.score > 0);
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      SOURCE_ORDER.indexOf(a.c.kind) - SOURCE_ORDER.indexOf(b.c.kind) ||
      a.c.upstreamIndex - b.c.upstreamIndex,
  );
  return scored.slice(0, DEEP_RESEARCH_LIMIT).map((s) => s.c.result);
}

/** Envelope extras from provenance blocks: the two channels `provenancedResult` also emits. */
export function provenanceExtras(blocks: Provenance | Provenance[]): EnvelopeExtras {
  const rendered = Array.isArray(blocks) ? blocks.map((b) => renderConcise(b)) : renderConcise(blocks);
  const attribution = attributionList(Array.isArray(blocks) ? blocks : [blocks]);
  return {
    structured: { provenance: rendered, attribution },
    meta: { [PROVENANCE_META_KEY]: rendered, [ATTRIBUTION_META_KEY]: attribution },
  };
}

/**
 * `search`: local index + live fan-out, ranked together. Provenance is
 * multi-source like `find_equivalent`: one block per source that answered
 * (a source that failed gets none), all marked derived — the order across
 * sources is computed here.
 */
export async function deepResearchSearch(query: string): Promise<SearchReply> {
  const [icd11, loinc, rxnorm, mesh] = await Promise.all([
    searchIcd11(query),
    searchLoinc(query),
    searchRxNorm(query),
    searchMesh(query),
  ]);
  const outcomes = [...searchLocal(query), icd11, loinc, rxnorm, mesh].sort(
    (a, b) => SOURCE_ORDER.indexOf(a.kind) - SOURCE_ORDER.indexOf(b.kind),
  );
  const results = rankCandidates(query, outcomes);
  // One block per preset (the two CID-10 kinds share DataSUS), in source order.
  const seen = new Set<MedicalSourceKey>();
  const blocks: Provenance[] = [];
  for (const o of outcomes) {
    if (o.error !== null) continue;
    const key = SOURCE_KEY[o.kind];
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push(medicalProvenance(key, { derived: { note: RANKING_METHOD_NOTE } }));
  }
  return { results, extras: provenanceExtras(blocks) };
}

// ---------------------------------------------------------------------------
// fetch — the real lookup handler of the id's terminology
// ---------------------------------------------------------------------------

/** Splits an id into its kind and the bare key; null for an unknown prefix. */
export function parseDocId(id: string): { kind: DocKind; key: string } | null {
  for (const kind of SOURCE_ORDER) {
    const prefix = DEEP_RESEARCH_ID_PREFIXES[kind];
    if (id.startsWith(prefix) && id.length > prefix.length) {
      return { kind, key: id.slice(prefix.length) };
    }
  }
  return null;
}

type Structured = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Title and canonical URL of a rendered document, from the handler's typed payload. */
function describeDocument(kind: DocKind, key: string, s: Structured): { title: string; url: string } | null {
  switch (kind) {
    case 'cid10': {
      const hit = s.hit as Structured | null | undefined;
      if (!hit || s.found !== true) return null;
      const display = str(hit.display) ?? key;
      return { title: `CID-10 ${display} — ${str(hit.title) ?? ''}`.trim(), url: urlIcd10(display) };
    }
    case 'cid10Chapter': {
      const chapter = s.chapter as Structured | null | undefined;
      if (!chapter) return null;
      const num = Number(chapter.num ?? key);
      return {
        title: `CID-10 — Capítulo ${ROMAN[num - 1] ?? num}: ${str(chapter.title) ?? ''}`.trim(),
        url: urlIcd10Chapter(num),
      };
    }
    case 'icd11': {
      const url = str(s.uri) ? urlIcd11(s.uri as string) : null;
      if (!url) return null;
      return { title: `ICD-11 ${str(s.code) ?? key} — ${str(s.title) ?? ''}`.trim(), url };
    }
    case 'loinc': {
      const num = str(s.loinc_num) ?? key;
      return { title: `LOINC ${num} — ${str(s.long_common_name) ?? ''}`.trim(), url: urlLoinc(num) };
    }
    case 'rxnorm': {
      const rxcui = str(s.rxcui) ?? key;
      return { title: `RxNorm ${rxcui} — ${str(s.name) ?? ''}`.trim(), url: urlRxNorm(rxcui) };
    }
    case 'mesh': {
      const id = str(s.id) ?? key;
      return { title: `MeSH ${id} — ${str(s.label) ?? ''}`.trim(), url: urlMesh(id) };
    }
    case 'version': {
      const list = s.terminologies as Structured[] | undefined;
      const m = list?.find((t) => t.code === key);
      if (!m) return null;
      return {
        title: `${str(m.name) ?? key} — ${str(m.full_name) ?? ''} (version ${str(m.current_version) ?? '?'})`,
        url: str(m.source_url) ?? '',
      };
    }
  }
}

/**
 * `fetch`: route the id to the lookup tool of its terminology, reuse the
 * Markdown as `text` and the provenance channels as the envelope extras.
 * Unknown prefix → null (the factory answers "not found"); a lookup that
 * errors (bad code, upstream down) throws with the tool's own message.
 */
export async function deepResearchFetch(id: string): Promise<FetchReply | null> {
  const parsed = parseDocId(id);
  if (!parsed) return null;
  const { kind, key } = parsed;
  // Local kinds are known exhaustively: an id outside the index is "not
  // found" before any lookup runs (a malformed chapter number, a code the
  // dataset lacks).
  if (LOCAL_KINDS.includes(kind) && !getLocalIndex().byId.has(id)) return null;
  const { tool, arg } = DETAIL_TOOL[kind];
  const handler = toolRegistry.getHandler(tool);
  if (!handler) throw new Error(`tool "${tool}" is not registered`);

  const value: unknown = kind === 'cid10Chapter' ? Number(key) : key;
  const result = await handler({ [arg]: value });
  const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? '';
  if (result.isError === true) throw new Error(text || `\`${tool}\` failed`);
  const structured = (result.structuredContent ?? {}) as Structured;
  const described = describeDocument(kind, key, structured);
  // A well-formed id whose entity does not exist (CID-10 code absent from
  // the dataset, chapter out of range) — the lookup answered, not an error.
  if (!described) return null;

  const document: FetchDocument = {
    id,
    title: described.title,
    text,
    url: described.url,
    metadata: { terminology: kind === 'cid10Chapter' ? 'cid10' : kind, key, rendered_by: tool },
  };
  const meta = (result as { _meta?: Record<string, unknown> })._meta ?? {};
  return {
    document,
    extras: {
      structured: { provenance: structured.provenance, attribution: structured.attribution },
      meta,
    },
  };
}

// ---------------------------------------------------------------------------
// Registration — the package's factory, captured into this server's registry
// ---------------------------------------------------------------------------

interface CapturedRegistration {
  name: string;
  config: {
    title?: string;
    description: string;
    inputSchema: z.ZodTypeAny;
    outputSchema?: z.ZodTypeAny;
    annotations?: Tool['annotations'];
  };
  callback: (args: unknown) => Promise<CallToolResult>;
}

/**
 * Runs the factory against a sink that records its two `registerTool`
 * calls instead of a real `McpServer`, then converts each into a registry
 * pair: the Zod schemas become the advertised JSON Schemas (same builders
 * as every other tool) and the handler validates its input with the
 * contract schema before delegating (SDK-side validation is permissive in
 * this server — see `register.ts`).
 */
function captureDeepResearchTools(): Record<DeepResearchToolName, { tool: Tool; handler: ToolHandler }> {
  const captured: CapturedRegistration[] = [];
  const sink = {
    registerTool: (
      name: string,
      config: CapturedRegistration['config'],
      callback: CapturedRegistration['callback'],
    ) => {
      captured.push({ name, config, callback });
    },
  };

  registerDeepResearchTools(sink as unknown as McpServer, {
    locale: 'en',
    search: deepResearchSearch,
    fetch: deepResearchFetch,
    corpus:
      'medical terminologies (CID-10 categories and chapters, ICD-11, LOINC, RxNorm, MeSH, terminology version records)',
    richTools:
      'the terminology tools (`icd11_*`, `cid10_*`, `loinc_*`, `rxnorm_*`, `mesh_*`, `atc_*`, `map_*`, `find_equivalent`, `validate_codes`)',
    limit: DEEP_RESEARCH_LIMIT,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    // `search` is multi-source (one block per source that answered, like
    // `find_equivalent`); `fetch` renders one entity from one source.
    extendOutputSchema: (schema) =>
      'results' in schema.shape ? withProvenanceMulti(schema) : withProvenance(schema),
  });

  const { searchInputSchema, fetchInputSchema } = contractSchemas('en');
  const inputSchemas: Record<DeepResearchToolName, z.ZodTypeAny> = {
    search: searchInputSchema,
    fetch: fetchInputSchema,
  };

  const out = {} as Record<DeepResearchToolName, { tool: Tool; handler: ToolHandler }>;
  for (const name of DEEP_RESEARCH_TOOLS) {
    const reg = captured.find((c) => c.name === name);
    if (!reg || !reg.config.outputSchema) throw new Error(`factory did not register "${name}"`);
    const tool: Tool = {
      name,
      ...(reg.config.title !== undefined ? { title: reg.config.title } : {}),
      description: reg.config.description,
      inputSchema: buildInputSchema(reg.config.inputSchema),
      outputSchema: buildOutputSchema(reg.config.outputSchema),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    };
    const handler: ToolHandler = async (args) => {
      let parsed: unknown;
      try {
        parsed = inputSchemas[name].parse(args);
      } catch (e) {
        return handleToolError(e);
      }
      return reg.callback(parsed);
    };
    out[name] = { tool, handler };
  }
  return out;
}

const deepResearch = captureDeepResearchTools();

toolRegistry.register(deepResearch.search.tool, deepResearch.search.handler);
toolRegistry.register(deepResearch.fetch.tool, deepResearch.fetch.handler);
