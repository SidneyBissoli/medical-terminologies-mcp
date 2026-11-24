/**
 * ICF Tools for Medical Terminologies MCP Server (PROGRESS.md 24.3)
 *
 * - icf_search: Text search in the ICF linearization
 * - icf_lookup: Category details by ICF code or URI
 *
 * ICF (International Classification of Functioning, Disability and Health) is
 * served by the same WHO ICD-API, credential and pinned release as ICD-11
 * (measured 2026-11-23: codeinfo, search in en/pt, autocode, release list).
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/server';
import { toolRegistry } from '../server-core.js';
import { getWHOClient, ICD11EntityResponse } from '../clients/who-client.js';
import {
  ICFSearchParamsSchema,
  ICFLookupParamsSchema,
  ICFSearchOutputSchema,
  ICFLookupOutputSchema,
  ICFSearchOutput,
  ICFLookupOutput,
  ApiError,
} from '../types/index.js';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
  naoEncontrado,
  falhaDaFonte,
} from '../utils/zod-schema.js';
import { medicalProvenance, provenancedResult, withProvenance } from '../provenance.js';

/** All icf_* responses come from the WHO ICD-API, ICF linearization. */
const icfProvenance = () => medicalProvenance('WHO_ICF_API');

type ICFComponent = ICFSearchOutput['entities'][number]['component'];

const COMPONENT_BY_LETTER: Record<string, Exclude<ICFComponent, null>> = {
  b: 'body_functions',
  s: 'body_structures',
  d: 'activities_participation',
  e: 'environmental_factors',
};

const COMPONENT_LABEL: Record<Exclude<ICFComponent, null>, string> = {
  body_functions: 'Body functions',
  body_structures: 'Body structures',
  activities_participation: 'Activities and participation',
  environmental_factors: 'Environmental factors',
};

/** ICF component from the code letter; null without a code. */
export function icfComponent(code: string | null | undefined): ICFComponent {
  if (!code) return null;
  return COMPONENT_BY_LETTER[code.trim().charAt(0).toLowerCase()] ?? null;
}

/**
 * The WHO search marks matches with <em class='found'> even with highlighting
 * off in some fields. Drop that markup, then any stray angle bracket: a
 * multi-character tag regex alone leaves "<script" behind on input like
 * "<<b>script>" (CodeQL js/incomplete-multi-character-sanitization).
 */
export function plainTitle(title: string): string {
  return title.replace(/<\/?em\b[^>]*>/gi, '').replace(/[<>]/g, '');
}

// ============================================================================
// Tool Definitions
// ============================================================================

const icfSearchTool: Tool = {
  name: 'icf_search',
  title: 'Search ICF',
  description: `Search the WHO ICF (International Classification of Functioning, Disability and Health) for functioning and disability concepts: body functions (b), body structures (s), activities and participation (d), environmental factors (e).

Use this tool to:
- Find the ICF code for a function or activity ("walking" → d450 Walking)
- Code rehabilitation, home-care or disability findings, which ICD-11 (diagnoses) does not cover
- Search in WHO's official translations — e.g. \`language: "pt"\` ("andar" → d450 Andar). Never machine-translated.

Returns matching categories with code, title, ICF component, relevance score and URI, in WHO relevance order. ICF has no category for every measurement: "walking speed" returns d450 Walking (the activity), not a speed category, because ICF classifies functioning, not test results — use loinc_search for the measured observation.

When NOT to use: for diseases and diagnoses use icd11_search; for lab tests and clinical measurements use loinc_search.`,
  inputSchema: buildInputSchema(ICFSearchParamsSchema),
  outputSchema: buildOutputSchema(withProvenance(ICFSearchOutputSchema)),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const icfLookupTool: Tool = {
  name: 'icf_lookup',
  title: 'ICF Category Details',
  description: `Get the official details of ONE ICF category you already have a code or URI for: title, definition, inclusions, exclusions, component and WHO browser link.

Provide \`code\` (a component letter b/s/d/e and 1-5 digits, e.g. "d450", "b28013") or \`uri\` (an ICF URI a previous answer returned) — at least one is required. Qualifiers such as ".qp8" are not part of the code. Set \`language\` for WHO's official translations (e.g. \`language: "pt"\`).

Returns a single entity. A code WHO does not know comes back as a "not found" error, never an empty record.

When NOT to use: to find a code from words, use icf_search first; for ICD-11 diagnosis codes (like "5A11"), use icd11_lookup.`,
  inputSchema: buildInputSchema(ICFLookupParamsSchema),
  outputSchema: buildOutputSchema(withProvenance(ICFLookupOutputSchema)),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

// ============================================================================
// Formatters
// ============================================================================

function formatEntity(entity: ICD11EntityResponse): string {
  const lines: string[] = [];
  const title = entity.title?.['@value'] || 'Unknown';
  const code = entity.code || entity.codeRange || 'No code';
  lines.push(`# ${code} - ${title}`);
  const component = icfComponent(entity.code);
  if (component) lines.push(`*ICF component: ${COMPONENT_LABEL[component]}*`);
  lines.push('');

  if (entity.definition?.['@value']) {
    lines.push(`**Definition:** ${entity.definition['@value']}`);
    lines.push('');
  }
  if (entity.inclusion && entity.inclusion.length > 0) {
    lines.push('**Inclusions:**');
    for (const inc of entity.inclusion) lines.push(`- ${inc.label?.['@value'] || inc['@id']}`);
    lines.push('');
  }
  if (entity.exclusion && entity.exclusion.length > 0) {
    lines.push('**Exclusions:**');
    for (const exc of entity.exclusion) lines.push(`- ${exc.label?.['@value'] || exc['@id']}`);
    lines.push('');
  }
  if (entity.browserUrl) lines.push(`**Browser:** ${entity.browserUrl}`);
  return lines.join('\n');
}

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleICFSearch(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ICFSearchParamsSchema.parse(args);
    const results = await getWHOClient().searchICF(params.query, params.language, params.max_results);

    if (results.error) {
      return falhaDaFonte(`Search error: ${results.errorMessage || 'Unknown error'}`);
    }

    const dest = results.destinationEntities ?? [];
    const top = dest.slice(0, params.max_results);

    const structured: ICFSearchOutput = {
      query: params.query,
      total_count: dest.length,
      entities: top.map((e) => ({
        code: e.theCode || null,
        title: plainTitle(e.title),
        component: icfComponent(e.theCode),
        score: e.score,
        uri: e.id,
        is_leaf: e.isLeaf,
      })),
    };

    if (top.length === 0) {
      return provenancedResult({
        text: `No results found for "${params.query}" in ICF.`,
        structured,
        provenance: icfProvenance(),
      });
    }

    const body = structured.entities
      .map((e, i) => {
        const comp = e.component ? ` (${COMPONENT_LABEL[e.component]})` : '';
        return `${i + 1}. **${e.code ?? 'No code'}** - ${e.title}${comp}\n   Score: ${e.score.toFixed(2)} | Leaf: ${e.is_leaf ? 'Yes' : 'No'}`;
      })
      .join('\n\n');

    return provenancedResult({
      text: `## ICF Search Results for "${params.query}"\n\nFound ${dest.length} results (showing top ${top.length}):\n\n${body}`,
      structured,
      provenance: icfProvenance(),
    });
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleICFLookup(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ICFLookupParamsSchema.parse(args);
    const entity = await getWHOClient().lookupICF((params.code || params.uri) as string, params.language);

    const structured: ICFLookupOutput = {
      code: entity.code ?? null,
      code_range: entity.codeRange ?? null,
      uri: entity['@id'],
      title: entity.title?.['@value'] ?? 'Unknown',
      component: icfComponent(entity.code),
      class_kind: entity.classKind ?? null,
      definition: entity.definition?.['@value'] ?? null,
      exclusions: (entity.exclusion ?? []).map((e) => ({ uri: e['@id'], label: e.label?.['@value'] ?? e['@id'] })),
      inclusions: (entity.inclusion ?? []).map((i) => ({ uri: i['@id'], label: i.label?.['@value'] ?? i['@id'] })),
      browser_url: entity.browserUrl ?? null,
    };

    return provenancedResult({
      text: formatEntity(entity),
      structured,
      provenance: icfProvenance(),
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      return naoEncontrado(`ICF category not found: ${args.code || args.uri}. Check the code, or find it with icf_search.`);
    }
    return handleToolError(error);
  }
}

toolRegistry.register(icfSearchTool, handleICFSearch);
toolRegistry.register(icfLookupTool, handleICFLookup);
