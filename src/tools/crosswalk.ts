/**
 * Crosswalk Tools for Medical Terminologies MCP Server
 *
 * - map_icd10_to_icd11: Map ICD-10 codes to ICD-11
 * - map_snomed_to_icd10: Map SNOMED CT to ICD-10
 * - map_loinc_to_snomed: Map LOINC to SNOMED CT
 * - find_equivalent: Search for equivalent terms across terminologies
 *
 * Note: Some mappings may not be freely available. Tools return explanatory
 * messages when mappings are unavailable.
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toolRegistry } from '../server-core.js';
import { getWHOClient } from '../clients/who-client.js';
import { getSNOMEDClient, SNOMED_DISCLAIMER } from '../clients/snomed-client.js';
import { getNLMClient } from '../clients/nlm-client.js';
import { getRxNormClient } from '../clients/rxnorm-client.js';
import { getMeSHClient } from '../clients/mesh-client.js';
import { getICD10ToICD11MapClient } from '../clients/icd10-icd11-map-client.js';
import { ApiError } from '../types/index.js';
import {
  MapICD10ToICD11ParamsSchema,
  MapSNOMEDToICD10ParamsSchema,
  MapLOINCToSNOMEDParamsSchema,
  FindEquivalentParamsSchema,
  FindEquivalentOutputSchema,
  FindEquivalentOutput,
} from '../types/index.js';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
} from '../utils/zod-schema.js';
import { SNOMED_TOOLS_ENABLED, SNOMED_DISABLED_NOTE } from '../utils/feature-flags.js';

// ============================================================================
// Tool Definitions
// ============================================================================

const mapICD10ToICD11Tool: Tool = {
  name: 'map_icd10_to_icd11',
  description: `Authoritative ICD-10 → ICD-11 mapping using WHO transition tables (release 2025-01, bundled with the server).

Returns the primary 1:1 ICD-11 category for the ICD-10 code plus any alternative ICD-11 candidates that WHO documents (some ICD-10 concepts split into multiple ICD-11 entities). For each mapping, includes the ICD-11 code, title, chapter, and the Foundation URI / Linearization URI for navigating to the full entity definition.

Use this for clinical coding, billing migration, retrospective analysis, and any workflow that needs authoritative mapping rather than text-search candidates. Coverage: 11,243 ICD-10 categories (excludes chapters and blocks like "A00-A09" which aren't used in clinical coding).

Provide a code like "E11" (Type 2 diabetes), "I21" (Acute MI), or "A07.8" (4 alternatives in WHO's table). Both dotted ("A07.8") and undotted ("A078") forms are accepted.

Returns "no mapping" when the code isn't in the WHO category-level table — that's the honest answer rather than a fuzzy search fallback.`,
  inputSchema: buildInputSchema(MapICD10ToICD11ParamsSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const mapSNOMEDToICD10Tool: Tool = {
  name: 'map_snomed_to_icd10',
  description: `Map a SNOMED CT concept to ICD-10.

Use this tool to:
- Find ICD-10 codes for a SNOMED CT concept
- Support billing and reporting from clinical data
- Cross-reference between clinical and classification systems

Provide a SNOMED CT ID like "73211009" (Diabetes mellitus).

⚠️ SNOMED CT content requires IHTSDO license for production use.`,
  inputSchema: buildInputSchema(MapSNOMEDToICD10ParamsSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const mapLOINCToSNOMEDTool: Tool = {
  name: 'map_loinc_to_snomed',
  description: `This tool looks up a LOINC code in NLM Clinical Tables and returns guidance on where to obtain a LOINC → SNOMED CT mapping. It does not perform the mapping.

Direct LOINC → SNOMED CT mappings are not freely available via API. UMLS Metathesaurus contains the relationships but requires an individual UMLS Terminology Services license; the LOINC SNOMED CT Expression Association is published by Regenstrief Institute as part of the LOINC release and requires authenticated download from loinc.org under the LOINC license.

For programmatic LOINC → SNOMED mapping, use UMLS or the LOINC Expression Association files. For interactive lookup, use the SNOMED CT browser available to your organization or the Regenstrief RELMA desktop tool.

Provide a LOINC code like "2339-0" (Glucose) or "718-7" (Hemoglobin).`,
  inputSchema: buildInputSchema(MapLOINCToSNOMEDParamsSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const findEquivalentTool: Tool = {
  name: 'find_equivalent',
  description: `Search for equivalent terms across multiple medical terminologies.

Use this tool to:
- Find the same concept in different coding systems
- Compare how terminologies represent a concept
- Support terminology mapping and data integration

Searches across: ICD-11, SNOMED CT, LOINC, RxNorm, and MeSH. Set \`target_terminologies\` to limit which are searched, or set \`source_terminology\` to exclude one (e.g. when you already have a code from that terminology and want equivalents elsewhere). The two combine: source is subtracted from targets.`,
  inputSchema: buildInputSchema(FindEquivalentParamsSchema),
  outputSchema: buildOutputSchema(FindEquivalentOutputSchema),
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
      return { content: [{ type: 'text', text: lines.join('\n') }] };
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

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleMapSNOMEDToICD10(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MapSNOMEDToICD10ParamsSchema.parse(args);
    const client = getSNOMEDClient();
    const concept = await client.getConcept(params.sctid);

    const lines: string[] = [];
    lines.push(`# SNOMED CT to ICD-10 Mapping`);
    lines.push('');
    lines.push(`**SNOMED CT ID:** ${params.sctid}`);

    if (concept) {
      lines.push(`**Preferred Term:** ${concept.pt}`);
    }
    lines.push('');

    lines.push('## Mapping Information');
    lines.push('');
    lines.push('SNOMED CT to ICD-10 mappings are available through:');
    lines.push('');
    lines.push('1. **SNOMED International Map Sets**');
    lines.push('   - Reference Set ID: 447562003 (ICD-10 Complex Map)');
    lines.push('   - Available via Snowstorm API with appropriate license');
    lines.push('');
    lines.push('2. **National Extensions**');
    lines.push('   - US: SNOMED CT to ICD-10-CM maps via NLM');
    lines.push('   - UK: NHS SNOMED-ICD-10 maps');
    lines.push('');

    if (concept) {
      lines.push('## Suggested Approach');
      lines.push('');
      lines.push(`For "${concept.pt}", consider:`);
      lines.push('');
      lines.push('1. Search ICD-10 for similar terms');
      lines.push('2. Use the SNOMED hierarchy to find mappable ancestors');
      lines.push('3. Consult official mapping tables from your national authority');
    }

    lines.push('');
    lines.push('---');
    lines.push(SNOMED_DISCLAIMER);

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error) {
    if (error instanceof ApiError && (error.message.includes('ETIMEDOUT') || error.message.includes('timeout'))) {
      return {
        content: [{
          type: 'text',
          text: `# SNOMED CT to ICD-10 Mapping\n\n**SNOMED CT ID:** ${args.sctid}\n\n⚠️ Unable to connect to SNOMED CT server.\n\nSNOMED CT to ICD-10 mappings are available through:\n\n1. **SNOMED International** - Reference Set 447562003\n2. **NLM UMLS** - Requires license\n3. **National Health Services** - Country-specific maps\n\n---\n${SNOMED_DISCLAIMER}`,
        }],
      };
    }
    return handleToolError(error);
  }
}

async function handleMapLOINCToSNOMED(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MapLOINCToSNOMEDParamsSchema.parse(args);
    const client = getNLMClient();
    const details = await client.getLOINCDetails(params.loinc_code);

    const lines: string[] = [];
    lines.push(`# LOINC code ${params.loinc_code} → SNOMED CT mapping guidance`);
    lines.push('');
    lines.push(
      'This output is a LOINC lookup plus guidance on where to obtain the LOINC → SNOMED CT mapping. The mapping itself is not performed here — direct LOINC → SNOMED CT mappings are not freely available via API.',
    );
    lines.push('');

    lines.push('## LOINC code details');
    lines.push('');
    if (details) {
      lines.push(`- **Code:** ${params.loinc_code}`);
      lines.push(`- **Long Common Name:** ${details.LONG_COMMON_NAME || '—'}`);
      lines.push(`- **Component:** ${details.COMPONENT || '—'}`);
      if (details.SYSTEM) {
        lines.push(`- **System:** ${details.SYSTEM}`);
      }
      if (details.PROPERTY) {
        lines.push(`- **Property:** ${details.PROPERTY}`);
      }
    } else {
      lines.push(`- **Code:** ${params.loinc_code}`);
      lines.push('- _The code was not found in NLM Clinical Tables. Verify the LOINC number; the format is "XXXXX-X" (e.g., "2339-0")._');
    }
    lines.push('');

    lines.push('## Mapping availability');
    lines.push('');
    lines.push('The two authoritative LOINC → SNOMED CT mapping sources both require licenses or authenticated downloads:');
    lines.push('');
    lines.push('1. **UMLS Metathesaurus** — contains LOINC ↔ SNOMED relationships in a queryable graph. Requires an individual UMLS Terminology Services (UTS) license, free for most uses but with annual renewal. Apply at https://uts.nlm.nih.gov/uts/.');
    lines.push('2. **LOINC SNOMED CT Expression Association** — published by Regenstrief Institute as part of each LOINC release; contains expression-level mappings as RF2 files. Requires acceptance of the LOINC license at https://loinc.org/downloads/. License is free for most uses.');
    lines.push('3. **Regenstrief RELMA** — free desktop application that bundles the LOINC release including the Expression Association files. Download at https://loinc.org/relma/.');
    lines.push('');

    lines.push('## Recommended workflow');
    lines.push('');
    if (details && details.COMPONENT) {
      lines.push(`1. Confirm the LOINC code's component (\`${details.COMPONENT}\`)${details.SYSTEM ? ` and system (\`${details.SYSTEM}\`)` : ''} from the details above.`);
    } else {
      lines.push("1. Verify the LOINC code first (use the `loinc_details` tool if needed) so you have the component, system, and method to match against.");
    }
    lines.push('2. For a single lookup, search the SNOMED CT browser available to your organization for the component name; verify the candidate matches the LOINC system, property, and method.');
    lines.push('3. For programmatic mapping or batch work, obtain the LOINC SNOMED CT Expression Association file (option 2 above) or UMLS access (option 1) and process locally.');
    lines.push('');

    lines.push('---');
    lines.push('This tool calls NLM Clinical Tables for LOINC details. It does not call SNOMED.');

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error) {
    return handleToolError(error);
  }
}

const ALL_TERMINOLOGIES = ['icd11', 'snomed', 'loinc', 'rxnorm', 'mesh'] as const;

type TerminologyKey = (typeof ALL_TERMINOLOGIES)[number];

const TERMINOLOGY_LABELS: Record<TerminologyKey, string> = {
  icd11: 'ICD-11',
  snomed: 'SNOMED CT',
  loinc: 'LOINC',
  rxnorm: 'RxNorm',
  mesh: 'MeSH',
};

type FindEquivalentEntry = NonNullable<FindEquivalentOutput['results']['icd11']>;

async function handleFindEquivalent(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = FindEquivalentParamsSchema.parse(args);
    const term = params.term;
    const requestedTargets = params.target_terminologies ?? [...ALL_TERMINOLOGIES];
    const targets: TerminologyKey[] = (params.source_terminology
      ? requestedTargets.filter((t) => t !== params.source_terminology)
      : requestedTargets) as TerminologyKey[];

    if (targets.length === 0) {
      const requested = params.target_terminologies
        ? `target_terminologies=${JSON.stringify(params.target_terminologies)}`
        : 'all terminologies';
      const empty: FindEquivalentOutput = {
        term,
        source_terminology: params.source_terminology ?? null,
        searched_terminologies: [],
        results: {},
      };
      return {
        content: [{
          type: 'text',
          text: `# Cross-Terminology Search: "${term}"\n\nNo terminologies left to search after excluding source_terminology="${params.source_terminology}" from ${requested}. Widen target_terminologies or drop source_terminology.`,
        }],
        structuredContent: empty,
      };
    }

    // Build a single typed map keyed by enum key. Markdown is derived from
    // this same map below — no duplicated data.
    const entries: Partial<Record<TerminologyKey, FindEquivalentEntry>> = {};
    const searches: Promise<void>[] = [];

    const ok = (items: FindEquivalentEntry['items']): FindEquivalentEntry => ({
      found: items.length > 0,
      error: null,
      items,
    });
    const fail = (error: string): FindEquivalentEntry => ({ found: false, error, items: [] });

    if (targets.includes('icd11')) {
      searches.push(
        (async () => {
          try {
            const client = getWHOClient();
            const response = await client.search(term, 'en', 5);
            const icdResults = response.destinationEntities ?? [];
            entries.icd11 = ok(
              icdResults.slice(0, 5).map((r) => ({
                code: r.theCode ?? 'N/A',
                title: r.title ?? 'N/A',
              })),
            );
          } catch (e) {
            entries.icd11 = fail(e instanceof Error ? e.message : 'Error');
          }
        })(),
      );
    }

    if (targets.includes('snomed')) {
      if (!SNOMED_TOOLS_ENABLED) {
        entries.snomed = fail(SNOMED_DISABLED_NOTE);
      } else {
        searches.push(
          (async () => {
            try {
              const client = getSNOMEDClient();
              const snomedResults = await client.searchConcepts(term, true, 5);
              entries.snomed = ok(
                snomedResults.map((r) => ({ code: r.conceptId, title: r.pt })),
              );
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : 'Error';
              entries.snomed = fail(errMsg.includes('ETIMEDOUT') ? 'Server unavailable' : errMsg);
            }
          })(),
        );
      }
    }

    if (targets.includes('loinc')) {
      searches.push(
        (async () => {
          try {
            const client = getNLMClient();
            const loincResponse = await client.searchLOINC(term, 5);
            const loincResults = loincResponse.items ?? [];
            entries.loinc = ok(
              loincResults.map((r) => ({ code: r.LOINC_NUM, title: r.LONG_COMMON_NAME })),
            );
          } catch (e) {
            entries.loinc = fail(e instanceof Error ? e.message : 'Error');
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
            entries.rxnorm = ok(
              rxResults.drugs.slice(0, 5).map((r) => ({ code: r.rxcui, title: r.name })),
            );
          } catch (e) {
            entries.rxnorm = fail(e instanceof Error ? e.message : 'Error');
          }
        })(),
      );
    }

    if (targets.includes('mesh')) {
      searches.push(
        (async () => {
          try {
            const client = getMeSHClient();
            const meshResults = await client.searchDescriptors(term, 'contains', 5);
            entries.mesh = ok(
              meshResults.map((r) => ({ code: r.id, title: r.label })),
            );
          } catch (e) {
            entries.mesh = fail(e instanceof Error ? e.message : 'Error');
          }
        })(),
      );
    }

    await Promise.all(searches);

    // Markdown derived from the same entries map, in target order so output
    // is stable regardless of which API resolved first.
    const lines: string[] = [];
    lines.push(`# Cross-Terminology Search: "${term}"`);
    if (params.source_terminology) {
      lines.push(`_Excluding source_terminology=\`${params.source_terminology}\` from the search._`);
    }
    lines.push('');

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
          lines.push(`- ${item.code} - ${item.title}`);
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

    if (targets.includes('snomed') && SNOMED_TOOLS_ENABLED) {
      lines.push('');
      lines.push(SNOMED_DISCLAIMER);
    }

    const structured: FindEquivalentOutput = {
      term,
      source_terminology: params.source_terminology ?? null,
      searched_terminologies: targets,
      results: entries,
    };

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

toolRegistry.register(mapICD10ToICD11Tool, handleMapICD10ToICD11);
toolRegistry.register(mapLOINCToSNOMEDTool, handleMapLOINCToSNOMED);
toolRegistry.register(findEquivalentTool, handleFindEquivalent);

// map_snomed_to_icd10 only works against a live Snowstorm; it's gated
// alongside the snomed_* tools. find_equivalent stays registered and
// reports SNOMED as unavailable when the flag is off.
if (SNOMED_TOOLS_ENABLED) {
  toolRegistry.register(mapSNOMEDToICD10Tool, handleMapSNOMEDToICD10);
}
