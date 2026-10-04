/**
 * Crosswalk Tools for Medical Terminologies MCP Server
 *
 * - map_icd10_to_icd11: Map ICD-10 codes to ICD-11
 * - validate_codes: Batch-validate codes across terminologies
 * - find_equivalent: Search for equivalent terms across terminologies
 *
 * SNOMED CT was retired in 2.0.0 (PROGRESS.md 15.2): the public Snowstorm
 * hosts are gone, the tools were off by default with zero measured use, and
 * the half-present terminology confused every third-party catalog. With it
 * went map_snomed_to_icd10 and map_loinc_to_snomed (guidance-only).
 *
 * Note: Some mappings may not be freely available. Tools return explanatory
 * messages when mappings are unavailable.
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/server';
import { toolRegistry } from '../server-core.js';
import { getWHOClient } from '../clients/who-client.js';
import { getNLMClient } from '../clients/nlm-client.js';
import { getRxNormClient } from '../clients/rxnorm-client.js';
import { getMeSHClient } from '../clients/mesh-client.js';
import { getICD10ToICD11MapClient } from '../clients/icd10-icd11-map-client.js';
import { getCID10Client } from '../clients/cid10-client.js';
import { ApiError } from '../types/index.js';
import {
  MapICD10ToICD11ParamsSchema,
  MapICD10ToICD11OutputSchema,
  MapICD10ToICD11Output,
  FindEquivalentParamsSchema,
  FindEquivalentOutputSchema,
  FindEquivalentOutput,
  ValidateCodesParamsSchema,
  ValidateCodesOutputSchema,
  ValidateCodesOutput,
  ValidateCodesResult,
  ValidateCodesTerminology,
} from '../types/index.js';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
} from '../utils/zod-schema.js';
import { lexicalScore, normalizeForMatch, RANKING_METHOD_NOTE } from '../utils/lexical-score.js';
import {
  medicalProvenance,
  provenancedResult,
  withProvenance,
  withProvenanceMulti,
  type MedicalSourceKey,
  type Provenance,
} from '../provenance.js';

/**
 * Source preset per terminology, for the multi-source tools. One block PER
 * SOURCE is a contract rule (license segregation) — blocks are never merged.
 */
const SOURCE_BY_TERMINOLOGY: Record<ValidateCodesTerminology, MedicalSourceKey> = {
  icd11: 'WHO_ICD_API',
  icd10: 'WHO_TRANSITION_TABLES',
  cid10: 'DATASUS_CID10',
  loinc: 'CLINICALTABLES_LOINC',
  rxnorm: 'NLM_RXNAV',
  mesh: 'NLM_MESH',
  atc: 'NLM_RXCLASS_ATC',
};

/** Transition-tables block with the live bundled-dataset version attached. */
function transitionTablesProvenance(derivedNote?: string): Provenance {
  const version = getICD10ToICD11MapClient().getVersion();
  return medicalProvenance('WHO_TRANSITION_TABLES', {
    dataset: { id: 'icd10-to-icd11', version },
    dataVintage: version,
    citationDetail: version,
    ...(derivedNote !== undefined ? { derived: { note: derivedNote } } : {}),
  });
}

function terminologyProvenance(t: ValidateCodesTerminology): Provenance {
  if (t === 'icd10') return transitionTablesProvenance();
  return medicalProvenance(SOURCE_BY_TERMINOLOGY[t]);
}

// ============================================================================
// Tool Definitions
// ============================================================================

const mapICD10ToICD11Tool: Tool = {
  name: 'map_icd10_to_icd11',
  title: 'Map ICD-10 to ICD-11',
  description: `Authoritative ICD-10 → ICD-11 mapping using WHO transition tables (release 2025-01, bundled with the server).

Returns the primary 1:1 ICD-11 category for the ICD-10 code plus any alternative ICD-11 candidates that WHO documents (some ICD-10 concepts split into multiple ICD-11 entities). For each mapping, includes the ICD-11 code, title, chapter, and the Foundation URI / Linearization URI for navigating to the full entity definition.

Use this for clinical coding, billing migration, retrospective analysis, and any workflow that needs authoritative mapping rather than text-search candidates. Coverage: 11,243 ICD-10 categories (excludes chapters and blocks like "A00-A09" which aren't used in clinical coding).

Provide a code like "E11" (Type 2 diabetes), "I21" (Acute MI), or "A07.8" (4 alternatives in WHO's table). Both dotted ("A07.8") and undotted ("A078") forms are accepted.

Returns "no mapping" when the code isn't in the WHO category-level table — that's the honest answer rather than a fuzzy search fallback.`,
  inputSchema: buildInputSchema(MapICD10ToICD11ParamsSchema),
  outputSchema: buildOutputSchema(withProvenance(MapICD10ToICD11OutputSchema)),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const validateCodesTool: Tool = {
  name: 'validate_codes',
  title: 'Validate Medical Codes',
  description: `Validate a mixed batch of medical codes against their source terminologies. Useful for retrospective analysis of legacy databases — flag codes that no longer exist, surface ICD-10 → ICD-11 replacements, and grade activity status where the terminology exposes it.

For each input \`{ code, terminology }\`, returns:
- **valid**: whether the code exists in the source terminology.
- **active**: whether the code is currently active. Null when the source doesn't expose an explicit active/inactive distinction at category level (CID-10, ATC, ICD-11, RxNorm, MeSH all return null today; LOINC returns a real boolean).
- **title**: the official label/name when available.
- **replaced_by**: a successor code, populated today only for ICD-10 codes that have a primary ICD-11 mapping in the bundled WHO transition tables.
- **source**: human-readable provenance of the validation (terminology + release/version).
- **error**: non-null only when validation couldn't be performed (network error, upstream outage, etc.). \`valid: false\` + \`error: null\` means "code not found"; \`valid: false\` + \`error: set\` means "couldn't validate".

Terminology is **required per code** — auto-detection isn't supported because category codes like "A00" exist in both ICD-10 and CID-10. Accepted values: \`icd11\`, \`icd10\`, \`loinc\`, \`rxnorm\`, \`mesh\`, \`atc\`, \`cid10\`.

Hard cap of 50 codes per call; codes are validated in parallel through their respective clients, so total wall time scales with the slowest upstream + its rate limit (worst case ~10 s for a full batch hitting ICD-11).`,
  inputSchema: buildInputSchema(ValidateCodesParamsSchema),
  outputSchema: buildOutputSchema(withProvenanceMulti(ValidateCodesOutputSchema)),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const findEquivalentTool: Tool = {
  name: 'find_equivalent',
  title: 'Find Equivalents Across Terminologies',
  description: `Ranked unified search for equivalent terms across multiple medical terminologies.

Use this tool to:
- Find the same concept in different coding systems
- Compare how terminologies represent a concept
- Support terminology mapping and data integration

Searches across: ICD-11, LOINC, RxNorm, and MeSH. Set \`target_terminologies\` to limit which are searched, or set \`source_terminology\` to exclude one (e.g. when you already have a code from that terminology and want equivalents elsewhere). The two combine: source is subtracted from targets. \`limit\` caps candidates per terminology (default 5, max 10).

Every candidate carries \`match_score\` (lexical similarity to the search term, 0-1) and \`rank\` (global position across all searched terminologies) — both computed by this server, since upstreams don't expose comparable relevance scores. Candidates from different terminologies whose titles are lexically identical are clustered in \`groups\` — a strong same-concept signal (absence of a group is NOT evidence of non-equivalence).

Searches upstreams in English. For official pt-BR content, use the dedicated tools: \`icd11_search\`/\`mesh_search\` accept \`language: "pt"\`, and \`cid10_search\` is natively Portuguese.`,
  inputSchema: buildInputSchema(FindEquivalentParamsSchema),
  outputSchema: buildOutputSchema(withProvenanceMulti(FindEquivalentOutputSchema)),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleMapICD10ToICD11(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MapICD10ToICD11ParamsSchema.parse(args);
    const client = getICD10ToICD11MapClient();
    const inputCode = params.icd10_code.trim();
    const entry = client.lookup(inputCode);

    const structured: MapICD10ToICD11Output = {
      query: inputCode,
      found: entry !== null,
      icd10: entry?.icd10 ?? null,
      primary: entry?.primary ?? null,
      alternatives: entry?.alternatives ?? [],
      source: {
        publisher: 'WHO',
        version: client.getVersion(),
        release_date: client.getReleaseDate(),
      },
    };

    const lines: string[] = [];
    lines.push(`# ICD-10 → ICD-11 mapping for "${inputCode.toUpperCase()}"`);
    lines.push('');

    if (!entry) {
      lines.push('## No authoritative mapping');
      lines.push('');
      lines.push(
        `The code "${inputCode}" is not in the WHO ICD-10 → ICD-11 transition table (release ${client.getVersion()}). This usually means one of:`,
      );
      lines.push('');
      lines.push(
        '- The code is a chapter or block (e.g. "A00-A09") — those aren\'t included; query a category instead.',
      );
      lines.push('- The code is mis-typed or not a valid ICD-10 category.');
      lines.push('- The code was removed in the WHO restructuring; try a parent category.');
      lines.push('');
      lines.push('**Alternative:** Use `icd11_search` with the condition name to explore ICD-11 directly.');
      return provenancedResult({
        text: lines.join('\n'),
        structured,
        provenance: transitionTablesProvenance(),
      });
    }

    lines.push(
      `**ICD-10:** ${entry.icd10.code} — ${entry.icd10.title} (chapter ${entry.icd10.chapter})`,
    );
    lines.push('');

    lines.push('## Primary ICD-11 mapping');
    lines.push('');
    lines.push(`- **Code:** ${entry.primary.code}`);
    lines.push(`- **Title:** ${entry.primary.title}`);
    lines.push(`- **Chapter:** ${entry.primary.chapter}`);
    lines.push(`- **Foundation URI:** ${entry.primary.foundationUri}`);
    lines.push(`- **Linearization (MMS) URI:** ${entry.primary.linearizationUri}`);
    lines.push('');

    if (entry.alternatives.length > 0) {
      lines.push(`## Alternative ICD-11 candidates (${entry.alternatives.length})`);
      lines.push('');
      lines.push('WHO documents multiple ICD-11 entities that may map to this ICD-10 concept. Review the alternatives below to pick the best match for your context.');
      lines.push('');
      lines.push('| Code | Title | Chapter |');
      lines.push('|------|-------|---------|');
      for (const alt of entry.alternatives) {
        lines.push(`| ${alt.code} | ${alt.title} | ${alt.chapter} |`);
      }
      lines.push('');
    } else {
      lines.push('_No additional ICD-11 candidates beyond the primary mapping._');
      lines.push('');
    }

    lines.push('---');
    lines.push(
      `Source: WHO ICD-10 → ICD-11 transition tables, release ${client.getVersion()} (${client.getReleaseDate()}). Authoritative mapping, not a text-search heuristic.`,
    );

    return provenancedResult({
      text: lines.join('\n'),
      structured,
      provenance: transitionTablesProvenance(),
    });
  } catch (error) {
    return handleToolError(error);
  }
}

// ============================================================================
// validate_codes — batch cross-terminology validator
// ============================================================================

interface ValidateInput {
  code: string;
  terminology: ValidateCodesTerminology;
}

function notFoundResult(
  item: ValidateInput,
  source: string,
): ValidateCodesResult {
  return {
    code: item.code,
    terminology: item.terminology,
    valid: false,
    active: null,
    title: null,
    replaced_by: null,
    source,
    error: null,
  };
}

function errorResult(
  item: ValidateInput,
  source: string,
  message: string,
): ValidateCodesResult {
  return {
    code: item.code,
    terminology: item.terminology,
    valid: false,
    active: null,
    title: null,
    replaced_by: null,
    source,
    error: message,
  };
}

async function validateOneCode(item: ValidateInput): Promise<ValidateCodesResult> {
  try {
    switch (item.terminology) {
      case 'icd10': {
        const cli = getICD10ToICD11MapClient();
        const entry = cli.lookup(item.code);
        const source = `WHO ICD-10 → ICD-11 transition tables, release ${cli.getVersion()}`;
        if (!entry) return notFoundResult(item, source);
        return {
          code: item.code,
          terminology: 'icd10',
          valid: true,
          // ICD-10 is frozen at the WHO 10th revision; no per-code active flag.
          active: null,
          title: entry.icd10.title,
          replaced_by: `${entry.primary.code} (ICD-11: ${entry.primary.title})`,
          source,
          error: null,
        };
      }

      case 'icd11': {
        const cli = getWHOClient();
        const source = 'WHO ICD-11 API';
        try {
          const entity = await cli.lookup(item.code, 'en');
          // entity.title is { '@language', '@value' } — flatten for output.
          const title = (entity as { title?: { '@value'?: string } }).title?.['@value'] ?? null;
          return {
            code: item.code,
            terminology: 'icd11',
            valid: true,
            // WHO API doesn't expose explicit active/inactive at the entity
            // level; releases are versioned rather than retiring codes in place.
            active: null,
            title,
            replaced_by: null,
            source,
            error: null,
          };
        } catch (err) {
          if (err instanceof ApiError && err.code === 'NOT_FOUND') {
            return notFoundResult(item, source);
          }
          throw err;
        }
      }

      case 'cid10': {
        const cli = getCID10Client();
        const hit = cli.lookup(item.code);
        const source = 'CID-10 DataSUS V2008 (bundled)';
        if (!hit) return notFoundResult(item, source);
        return {
          code: item.code,
          terminology: 'cid10',
          valid: true,
          // CID-10 dataset is frozen at V2008 (since 2008); no active/inactive.
          active: null,
          title: hit.title,
          replaced_by: null,
          source,
          error: null,
        };
      }

      case 'loinc': {
        const cli = getNLMClient();
        const source = 'NLM Clinical Tables LOINC';
        const details = await cli.getLOINCDetails(item.code);
        if (!details) return notFoundResult(item, source);
        // STATUS is one of ACTIVE / TRIAL / DISCOURAGED / DEPRECATED on
        // canonical LOINC, but Clinical Tables sometimes returns it empty.
        const status = details.STATUS ?? '';
        const active = status === 'ACTIVE' ? true : status === '' ? null : false;
        return {
          code: item.code,
          terminology: 'loinc',
          valid: true,
          active,
          title: details.LONG_COMMON_NAME ?? null,
          replaced_by: null,
          source,
          error: null,
        };
      }

      case 'rxnorm': {
        const cli = getRxNormClient();
        const source = 'NIH RxNorm';
        const concept = await cli.getConcept(item.code);
        if (!concept) return notFoundResult(item, source);
        return {
          code: item.code,
          terminology: 'rxnorm',
          valid: true,
          // RxNorm has remappedTo for retired concepts but getConcept doesn't
          // surface it on the current shape; leave active null until a future
          // enhancement adds an explicit lifecycle lookup.
          active: null,
          title: concept.name,
          replaced_by: null,
          source,
          error: null,
        };
      }

      case 'mesh': {
        const cli = getMeSHClient();
        const source = 'NLM MeSH Linked Data';
        const desc = await cli.getDescriptor(item.code);
        if (!desc) return notFoundResult(item, source);
        return {
          code: item.code,
          terminology: 'mesh',
          valid: true,
          // MeSH refreshes descriptors annually; no in-place active/inactive.
          active: null,
          title: desc.label,
          replaced_by: null,
          source,
          error: null,
        };
      }

      case 'atc': {
        const cli = getRxNormClient();
        const source = 'NLM RxClass — WHO ATC';
        const atc = await cli.getATCByCode(item.code);
        if (!atc) return notFoundResult(item, source);
        return {
          code: item.code,
          terminology: 'atc',
          valid: true,
          active: null,
          title: atc.atc_name,
          replaced_by: null,
          source,
          error: null,
        };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const source = `${item.terminology} (validation failed)`;
    return errorResult(item, source, message);
  }
}

async function handleValidateCodes(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ValidateCodesParamsSchema.parse(args);
    const results = await Promise.all(params.codes.map(validateOneCode));

    const validCount = results.filter((r) => r.valid).length;
    const errorCount = results.filter((r) => r.error !== null).length;
    const invalidCount = results.length - validCount - errorCount;

    const lines: string[] = [];
    lines.push(`# Code Validation Results`);
    lines.push('');
    lines.push(
      `Total: ${results.length} · Valid: ${validCount} · Not found: ${invalidCount} · Errors: ${errorCount}`,
    );
    lines.push('');

    lines.push('| Code | Terminology | Valid | Active | Title | Replaced by | Source / Error |');
    lines.push('|------|-------------|-------|--------|-------|-------------|----------------|');

    for (const r of results) {
      const validCell = r.error
        ? '⚠️'
        : r.valid
          ? '✅'
          : '❌';
      const activeCell =
        r.active === true ? '✅' : r.active === false ? '❌' : '—';
      const titleCell = (r.title ?? '').replace(/\|/g, '\\|');
      const replacedCell = (r.replaced_by ?? '—').replace(/\|/g, '\\|');
      const sourceCell = (r.error ?? r.source).replace(/\|/g, '\\|');
      lines.push(
        `| ${r.code} | ${r.terminology} | ${validCell} | ${activeCell} | ${titleCell} | ${replacedCell} | ${sourceCell} |`,
      );
    }


    const structured: ValidateCodesOutput = {
      total: results.length,
      valid_count: validCount,
      invalid_count: invalidCount,
      error_count: errorCount,
      results,
    };

    // One block per terminology that actually answered (error === null);
    // terminologies that failed contributed no data — no block, no
    // attribution. All-failed batches fall back to the server block so the
    // response still carries the provenance channel.
    const answered = [
      ...new Set(results.filter((r) => r.error === null).map((r) => r.terminology)),
    ];
    const blocks =
      answered.length > 0
        ? answered.map((t) => terminologyProvenance(t))
        : [medicalProvenance('SERVER_METADATA')];

    return provenancedResult({
      text: lines.join('\n'),
      structured,
      provenance: blocks,
    });
  } catch (error) {
    return handleToolError(error);
  }
}

const ALL_TERMINOLOGIES = ['icd11', 'loinc', 'rxnorm', 'mesh'] as const;

type TerminologyKey = (typeof ALL_TERMINOLOGIES)[number];

const TERMINOLOGY_LABELS: Record<TerminologyKey, string> = {
  icd11: 'ICD-11',
  loinc: 'LOINC',
  rxnorm: 'RxNorm',
  mesh: 'MeSH',
};

type FindEquivalentEntry = NonNullable<FindEquivalentOutput['results']['icd11']>;

/** Raw per-terminology fan-out result, before server-side scoring. */
interface RawFanoutEntry {
  error: string | null;
  // `uri` when the terminology exposes one (ICD-11 foundation URI, MeSH
  // descriptor URI) — the ICD-11 license requires codes and titles to be
  // served with their URIs (§1.2.2–1.2.3).
  items: { code: string; title: string; uri: string | null }[];
}

async function handleFindEquivalent(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = FindEquivalentParamsSchema.parse(args);
    const term = params.term;
    const limit = params.limit ?? 5;
    const requestedTargets = params.target_terminologies ?? [...ALL_TERMINOLOGIES];
    const targets: TerminologyKey[] = (params.source_terminology
      ? requestedTargets.filter((t) => t !== params.source_terminology)
      : requestedTargets) as TerminologyKey[];

    const rankingMeta = { method: 'lexical' as const, note: RANKING_METHOD_NOTE };

    if (targets.length === 0) {
      const requested = params.target_terminologies
        ? `target_terminologies=${JSON.stringify(params.target_terminologies)}`
        : 'all terminologies';
      const empty: FindEquivalentOutput = {
        term,
        source_terminology: params.source_terminology ?? null,
        searched_terminologies: [],
        results: {},
        groups: [],
        ranking: rankingMeta,
      };
      // Nothing was searched — the message is server content.
      return provenancedResult({
        text: `# Cross-Terminology Search: "${term}"\n\nNo terminologies left to search after excluding source_terminology="${params.source_terminology}" from ${requested}. Widen target_terminologies or drop source_terminology.`,
        structured: empty,
        provenance: [medicalProvenance('SERVER_METADATA')],
      });
    }

    // Fan out to each upstream, collecting raw { code, title } candidates.
    // Scoring/ranking happens after the fan-out so every candidate competes
    // in one global order regardless of which API resolved first.
    const raw: Partial<Record<TerminologyKey, RawFanoutEntry>> = {};
    const searches: Promise<void>[] = [];

    const ok = (items: RawFanoutEntry['items']): RawFanoutEntry => ({ error: null, items });
    const fail = (error: string): RawFanoutEntry => ({ error, items: [] });

    if (targets.includes('icd11')) {
      searches.push(
        (async () => {
          try {
            const client = getWHOClient();
            const response = await client.search(term, 'en', limit);
            const icdResults = response.destinationEntities ?? [];
            raw.icd11 = ok(
              icdResults.slice(0, limit).map((r) => ({
                code: r.theCode ?? 'N/A',
                title: r.title ?? 'N/A',
                uri: r.id ?? null,
              })),
            );
          } catch (e) {
            raw.icd11 = fail(e instanceof Error ? e.message : 'Error');
          }
        })(),
      );
    }

    if (targets.includes('loinc')) {
      searches.push(
        (async () => {
          try {
            const client = getNLMClient();
            const loincResponse = await client.searchLOINC(term, limit);
            const loincResults = loincResponse.items ?? [];
            raw.loinc = ok(
              loincResults
                .slice(0, limit)
                .map((r) => ({ code: r.LOINC_NUM, title: r.LONG_COMMON_NAME, uri: null })),
            );
          } catch (e) {
            raw.loinc = fail(e instanceof Error ? e.message : 'Error');
          }
        })(),
      );
    }

    if (targets.includes('rxnorm')) {
      searches.push(
        (async () => {
          try {
            const client = getRxNormClient();
            const rxResults = await client.searchDrugs(term);
            raw.rxnorm = ok(
              rxResults.drugs
                .slice(0, limit)
                .map((r) => ({ code: r.rxcui, title: r.name, uri: null })),
            );
          } catch (e) {
            raw.rxnorm = fail(e instanceof Error ? e.message : 'Error');
          }
        })(),
      );
    }

    if (targets.includes('mesh')) {
      searches.push(
        (async () => {
          try {
            const client = getMeSHClient();
            const meshResults = await client.searchDescriptors(term, 'contains', limit);
            raw.mesh = ok(
              meshResults.slice(0, limit).map((r) => ({ code: r.id, title: r.label, uri: r.uri ?? null })),
            );
          } catch (e) {
            raw.mesh = fail(e instanceof Error ? e.message : 'Error');
          }
        })(),
      );
    }

    await Promise.all(searches);

    // Score every candidate against the search term, then assign one global
    // rank across all searched terminologies. Ties break by terminology
    // order then upstream order — deterministic for identical responses.
    interface ScoredCandidate {
      key: TerminologyKey;
      upstreamIndex: number;
      code: string;
      title: string;
      uri: string | null;
      match_score: number;
      rank: number;
    }
    const candidates: ScoredCandidate[] = [];
    for (const key of targets) {
      const entry = raw[key];
      if (!entry) continue;
      entry.items.forEach((item, upstreamIndex) => {
        candidates.push({
          key,
          upstreamIndex,
          code: item.code,
          title: item.title,
          uri: item.uri,
          match_score: lexicalScore(term, item.title),
          rank: 0,
        });
      });
    }
    candidates.sort(
      (a, b) =>
        b.match_score - a.match_score ||
        ALL_TERMINOLOGIES.indexOf(a.key) - ALL_TERMINOLOGIES.indexOf(b.key) ||
        a.upstreamIndex - b.upstreamIndex,
    );
    candidates.forEach((c, i) => {
      c.rank = i + 1;
    });

    // Project back into the per-terminology result map, items now ordered
    // by rank (best first) instead of upstream order.
    const entries: Partial<Record<TerminologyKey, FindEquivalentEntry>> = {};
    for (const key of targets) {
      const entry = raw[key];
      if (!entry) continue;
      const items = candidates
        .filter((c) => c.key === key)
        .sort((a, b) => a.rank - b.rank)
        .map((c) => ({
          code: c.code,
          title: c.title,
          uri: c.uri,
          match_score: c.match_score,
          rank: c.rank,
        }));
      entries[key] = { found: items.length > 0, error: entry.error, items };
    }

    // Cross-terminology grouping: candidates from DIFFERENT terminologies
    // whose normalized titles are identical. Conservative by design — see
    // the output-schema comment. Iterating in rank order makes the group
    // list come out sorted by best member score.
    const byNormalizedTitle = new Map<string, ScoredCandidate[]>();
    for (const c of candidates) {
      const normalized = normalizeForMatch(c.title);
      if (normalized.length === 0) continue;
      const bucket = byNormalizedTitle.get(normalized);
      if (bucket) bucket.push(c);
      else byNormalizedTitle.set(normalized, [c]);
    }
    const groups: FindEquivalentOutput['groups'] = [];
    for (const [normalized, members] of byNormalizedTitle) {
      const terminologies = [...new Set(members.map((m) => m.key))];
      if (terminologies.length < 2) continue;
      groups.push({
        normalized_title: normalized,
        terminologies,
        members: members.map((m) => ({
          terminology: m.key,
          code: m.code,
          title: m.title,
          match_score: m.match_score,
        })),
      });
    }

    // Markdown derived from the same entries map, in target order so output
    // is stable regardless of which API resolved first.
    const lines: string[] = [];
    lines.push(`# Cross-Terminology Search: "${term}"`);
    if (params.source_terminology) {
      lines.push(`_Excluding source_terminology=\`${params.source_terminology}\` from the search._`);
    }
    lines.push('');

    if (groups.length > 0) {
      lines.push(`## Cross-terminology matches (${groups.length})`);
      lines.push('');
      lines.push('Candidates from different terminologies with lexically identical titles — a strong signal they represent the same concept:');
      lines.push('');
      for (const group of groups) {
        const memberList = group.members
          .map((m) => `${TERMINOLOGY_LABELS[m.terminology]} \`${m.code}\``)
          .join(' · ');
        lines.push(`- **${group.members[0].title}** — ${memberList}`);
      }
      lines.push('');
    }

    for (const key of targets) {
      const entry = entries[key];
      if (!entry) continue;
      lines.push(`## ${TERMINOLOGY_LABELS[key]}`);
      lines.push('');
      if (entry.error) {
        lines.push(`⚠️ ${entry.error}`);
      } else if (!entry.found) {
        lines.push('No matches found.');
      } else {
        for (const item of entry.items) {
          lines.push(`- ${item.code} - ${item.title} _(rank ${item.rank}, score ${item.match_score.toFixed(3)})_`);
        }
      }
      lines.push('');
    }

    const foundIn = targets
      .filter((k) => entries[k]?.found)
      .map((k) => TERMINOLOGY_LABELS[k]);

    lines.push('---');
    lines.push('');
    if (foundIn.length > 0) {
      lines.push(`**Found in:** ${foundIn.join(', ')}`);
    } else {
      lines.push('**No matches found in any terminology.**');
    }

    lines.push('');
    lines.push(`_${RANKING_METHOD_NOTE}_`);


    const structured: FindEquivalentOutput = {
      term,
      source_terminology: params.source_terminology ?? null,
      searched_terminologies: targets,
      results: entries,
      groups,
      ranking: rankingMeta,
    };

    // One block per terminology that answered (even with zero hits — "no
    // matches" IS an answer from that source). match_score/rank/groups are
    // computed by THIS server, so every block carries derived: true with
    // the ranking-method note (contract v1.0 §derived).
    const answered = targets.filter((key) => raw[key]?.error === null);
    const blocks =
      answered.length > 0
        ? answered.map((key) =>
            medicalProvenance(SOURCE_BY_TERMINOLOGY[key], {
              derived: { note: RANKING_METHOD_NOTE },
            }),
          )
        : [medicalProvenance('SERVER_METADATA')];

    return provenancedResult({
      text: lines.join('\n'),
      structured,
      provenance: blocks,
    });
  } catch (error) {
    return handleToolError(error);
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

toolRegistry.register(mapICD10ToICD11Tool, handleMapICD10ToICD11);
toolRegistry.register(validateCodesTool, handleValidateCodes);
toolRegistry.register(findEquivalentTool, handleFindEquivalent);
