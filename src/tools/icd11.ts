/**
 * ICD-11 Tools for Medical Terminologies MCP Server
 *
 * - icd11_search: Text search in ICD-11 MMS
 * - icd11_lookup: Entity details by code or URI
 * - icd11_hierarchy: Parents and children of an entity
 * - icd11_chapters: List all ICD-11 chapters
 * - icd11_postcoordination: Postcoordination axes for a code
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toolRegistry } from '../server-core.js';
import { getWHOClient, ICD11DestinationEntity, ICD11EntityResponse } from '../clients/who-client.js';
import {
  ICD11SearchParamsSchema,
  ICD11LookupParamsSchema,
  ICD11HierarchyParamsSchema,
  ICD11ChaptersParamsSchema,
  ICD11PostcoordinationParamsSchema,
  ICD11SearchOutputSchema,
  ICD11LookupOutputSchema,
  ICD11HierarchyOutputSchema,
  ICD11ChaptersOutputSchema,
  ICD11PostcoordinationOutputSchema,
  ICD11SearchOutput,
  ICD11LookupOutput,
  ICD11HierarchyOutput,
  ICD11ChaptersOutput,
  ICD11PostcoordinationOutput,
  ApiError,
} from '../types/index.js';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
} from '../utils/zod-schema.js';

// ============================================================================
// Tool Definitions
// ============================================================================

const icd11SearchTool: Tool = {
  name: 'icd11_search',
  description: `Search for medical conditions, diseases, and health problems in ICD-11 (International Classification of Diseases, 11th Revision).

Use this tool to:
- Find ICD-11 codes for diagnoses
- Search for diseases by name or keyword
- Look up conditions in multiple languages

Returns matching entities with codes, titles, and relevance scores.`,
  inputSchema: buildInputSchema(ICD11SearchParamsSchema),
  outputSchema: buildOutputSchema(ICD11SearchOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const icd11LookupTool: Tool = {
  name: 'icd11_lookup',
  description: `Get detailed information about a specific ICD-11 entity by code or URI.

Use this tool to:
- Get the full definition of a disease
- Retrieve coding notes and exclusions
- Get the official title and synonyms

Provide either an ICD-11 code (e.g., "BA00") or a full foundation URI.`,
  inputSchema: buildInputSchema(ICD11LookupParamsSchema),
  outputSchema: buildOutputSchema(ICD11LookupOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const icd11HierarchyTool: Tool = {
  name: 'icd11_hierarchy',
  description: `Navigate the ICD-11 hierarchy to find parent or child entities.

Use this tool to:
- Find broader categories (parents) of a condition
- Find specific subtypes (children) of a condition
- Understand the classification structure

Direction 'parents' returns ancestor categories, 'children' returns subcategories.`,
  inputSchema: buildInputSchema(ICD11HierarchyParamsSchema),
  outputSchema: buildOutputSchema(ICD11HierarchyOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const icd11ChaptersTool: Tool = {
  name: 'icd11_chapters',
  description: `List all ICD-11 chapters (top-level categories).

Use this tool to:
- Get an overview of ICD-11 structure
- Find which chapter covers a body system or condition type
- Navigate to specific disease categories

ICD-11 has 28 chapters covering all areas of medicine.`,
  inputSchema: buildInputSchema(ICD11ChaptersParamsSchema),
  outputSchema: buildOutputSchema(ICD11ChaptersOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const icd11PostcoordinationTool: Tool = {
  name: 'icd11_postcoordination',
  description: `Get postcoordination information for an ICD-11 code.

Use this tool to:
- Find available axes for building composite codes
- Check required vs optional postcoordination
- Understand code extension possibilities

Postcoordination allows adding severity, laterality, anatomy, etc.`,
  inputSchema: buildInputSchema(ICD11PostcoordinationParamsSchema),
  outputSchema: buildOutputSchema(ICD11PostcoordinationOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

// ============================================================================
// Formatters
// ============================================================================

function formatSearchResult(entity: ICD11DestinationEntity, index: number): string {
  const lines: string[] = [];
  lines.push(`${index + 1}. **${entity.theCode || 'No code'}** - ${entity.title}`);

  if (entity.matchingPVs && entity.matchingPVs.length > 0) {
    const matches = entity.matchingPVs.map((pv) => pv.label).join(', ');
    lines.push(`   Matches: ${matches}`);
  }

  lines.push(`   Score: ${entity.score.toFixed(2)} | Leaf: ${entity.isLeaf ? 'Yes' : 'No'}`);

  return lines.join('\n');
}

function formatEntity(entity: ICD11EntityResponse): string {
  const lines: string[] = [];

  const title = entity.title?.['@value'] || 'Unknown';
  const code = entity.code || entity.codeRange || 'No code';
  lines.push(`# ${code} - ${title}`);
  lines.push('');

  if (entity.definition?.['@value']) {
    lines.push(`**Definition:** ${entity.definition['@value']}`);
    lines.push('');
  }

  if (entity.longDefinition?.['@value']) {
    lines.push(`**Detailed Description:** ${entity.longDefinition['@value']}`);
    lines.push('');
  }

  if (entity.diagnosticCriteria?.['@value']) {
    lines.push(`**Diagnostic Criteria:** ${entity.diagnosticCriteria['@value']}`);
    lines.push('');
  }

  if (entity.codingNote?.['@value']) {
    lines.push(`**Coding Note:** ${entity.codingNote['@value']}`);
    lines.push('');
  }

  if (entity.exclusion && entity.exclusion.length > 0) {
    lines.push('**Exclusions:**');
    for (const exc of entity.exclusion) {
      const label = exc.label?.['@value'] || exc['@id'];
      lines.push(`- ${label}`);
    }
    lines.push('');
  }

  if (entity.inclusion && entity.inclusion.length > 0) {
    lines.push('**Inclusions (Synonyms):**');
    for (const inc of entity.inclusion) {
      const label = inc.label?.['@value'] || inc['@id'];
      lines.push(`- ${label}`);
    }
    lines.push('');
  }

  if (entity.indexTerm && entity.indexTerm.length > 0) {
    lines.push('**Index Terms:**');
    for (const term of entity.indexTerm.slice(0, 10)) {
      const label = term.label?.['@value'] || term['@id'];
      lines.push(`- ${label}`);
    }
    if (entity.indexTerm.length > 10) {
      lines.push(`- ... and ${entity.indexTerm.length - 10} more`);
    }
    lines.push('');
  }

  if (entity.browserUrl) {
    lines.push(`**Browser:** ${entity.browserUrl}`);
  }

  return lines.join('\n');
}

function formatHierarchyList(entities: ICD11EntityResponse[], direction: string): string {
  if (entities.length === 0) {
    return `No ${direction} found for this entity.`;
  }

  const lines: string[] = [];
  lines.push(`## ${direction.charAt(0).toUpperCase() + direction.slice(1)} (${entities.length})`);
  lines.push('');

  for (const entity of entities) {
    const title = entity.title?.['@value'] || 'Unknown';
    const code = entity.code || entity.codeRange || 'No code';
    lines.push(`- **${code}** - ${title}`);
  }

  return lines.join('\n');
}

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleICD11Search(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ICD11SearchParamsSchema.parse(args);
    const client = getWHOClient();
    const results = await client.search(params.query, params.language, params.max_results);

    if (results.error) {
      return {
        content: [{ type: 'text', text: `Search error: ${results.errorMessage || 'Unknown error'}` }],
        isError: true,
      };
    }

    const destEntities = results.destinationEntities ?? [];
    const top = destEntities.slice(0, params.max_results);

    const structured: ICD11SearchOutput = {
      query: params.query,
      total_count: destEntities.length,
      entities: top.map((e) => ({
        code: e.theCode ?? null,
        title: e.title,
        score: e.score,
        uri: e.id,
        is_leaf: e.isLeaf,
        matching_pvs: (e.matchingPVs ?? []).map((pv) => ({
          property_id: pv.propertyId,
          label: pv.label,
          score: pv.score,
          ...(pv.important !== undefined ? { important: pv.important } : {}),
        })),
      })),
    };

    if (top.length === 0) {
      return {
        content: [{ type: 'text', text: `No results found for "${params.query}" in ICD-11.` }],
        structuredContent: structured,
      };
    }

    const formatted = top
      .map((entity, index) => formatSearchResult(entity, index))
      .join('\n\n');

    const header = `## ICD-11 Search Results for "${params.query}"\n\nFound ${destEntities.length} results (showing top ${top.length}):\n\n`;

    return {
      content: [{ type: 'text', text: header + formatted }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleICD11Lookup(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ICD11LookupParamsSchema.parse(args);
    const codeOrUri = (params.code || params.uri) as string;

    const client = getWHOClient();
    const entity = await client.lookup(codeOrUri, params.language);

    const structured: ICD11LookupOutput = {
      code: entity.code ?? null,
      code_range: entity.codeRange ?? null,
      uri: entity['@id'],
      title: entity.title?.['@value'] ?? 'Unknown',
      class_kind: entity.classKind ?? null,
      block_id: entity.blockId ?? null,
      definition: entity.definition?.['@value'] ?? null,
      long_definition: entity.longDefinition?.['@value'] ?? null,
      diagnostic_criteria: entity.diagnosticCriteria?.['@value'] ?? null,
      coding_note: entity.codingNote?.['@value'] ?? null,
      exclusions: (entity.exclusion ?? []).map((e) => ({
        uri: e['@id'],
        label: e.label?.['@value'] ?? e['@id'],
      })),
      inclusions: (entity.inclusion ?? []).map((i) => ({
        uri: i['@id'],
        label: i.label?.['@value'] ?? i['@id'],
      })),
      index_terms: (entity.indexTerm ?? []).map((t) => ({
        uri: t['@id'],
        label: t.label?.['@value'] ?? t['@id'],
      })),
      browser_url: entity.browserUrl ?? null,
    };

    return {
      content: [{ type: 'text', text: formatEntity(entity) }],
      structuredContent: structured,
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      return {
        content: [{
          type: 'text',
          text: `Entity not found: ${args.code || args.uri}. Please verify the code is correct.`,
        }],
        isError: true,
      };
    }
    return handleToolError(error);
  }
}

async function handleICD11Hierarchy(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ICD11HierarchyParamsSchema.parse(args);
    const client = getWHOClient();

    const entities =
      params.direction === 'parents'
        ? await client.getParents(params.code)
        : await client.getChildren(params.code);

    const structured: ICD11HierarchyOutput = {
      code: params.code,
      direction: params.direction,
      entities: entities.map((e) => ({
        code: e.code ?? null,
        code_range: e.codeRange ?? null,
        title: e.title?.['@value'] ?? 'Unknown',
        uri: e['@id'],
      })),
    };

    const formatted = formatHierarchyList(entities, params.direction);

    return {
      content: [{
        type: 'text',
        text: `## ICD-11 Hierarchy for ${params.code}\n\n${formatted}`,
      }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleICD11Chapters(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ICD11ChaptersParamsSchema.parse(args);
    const client = getWHOClient();
    const chaptersResponse = await client.getChapters(params.language);
    const childUris = chaptersResponse.child ?? [];

    if (childUris.length === 0) {
      const empty: ICD11ChaptersOutput = { chapters: [] };
      return {
        content: [{ type: 'text', text: 'No chapters found in ICD-11.' }],
        structuredContent: empty,
      };
    }

    const settled = await Promise.allSettled(
      childUris.map((uri) => client.getEntity(uri, params.language)),
    );

    const lines: string[] = [];
    lines.push('# ICD-11 Chapters');
    lines.push('');
    lines.push(
      'The International Classification of Diseases, 11th Revision (ICD-11) is organized into the following chapters:',
    );
    lines.push('');

    const chapters: ICD11ChaptersOutput['chapters'] = settled.map((result, i) => {
      const number = i + 1;
      const uri = childUris[i];
      if (result.status === 'fulfilled') {
        const chapter = result.value;
        const title = chapter.title?.['@value'] ?? null;
        const code = chapter.code ?? null;
        const code_range = chapter.codeRange ?? null;
        const display = code ?? code_range ?? '';
        lines.push(`${number}. **${display}** - ${title ?? 'Unknown'}`);
        return { number, uri, code, code_range, title, error: null };
      }
      const reason =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      lines.push(`${number}. (Unable to load chapter)`);
      return { number, uri, code: null, code_range: null, title: null, error: reason };
    });

    const structured: ICD11ChaptersOutput = { chapters };

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleICD11Postcoordination(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ICD11PostcoordinationParamsSchema.parse(args);
    const client = getWHOClient();
    const postcoord = await client.getPostcoordination(params.code);
    const scales = postcoord.postcoordinationScale ?? [];

    const structured: ICD11PostcoordinationOutput = {
      code: params.code,
      axes: scales.map((s) => ({
        axis_name: s.axisName,
        required: Boolean(s.requiredPostcoordination),
        allow_multiple: s.allowMultipleValues === 'true',
        value_count: s.scaleEntity ? s.scaleEntity.length : null,
      })),
    };

    const lines: string[] = [];
    lines.push(`# Postcoordination for ${params.code}`);
    lines.push('');

    if (scales.length === 0) {
      lines.push('This entity does not have postcoordination axes available.');
    } else {
      lines.push('**Available Postcoordination Axes:**');
      lines.push('');
      for (const scale of scales) {
        const required = scale.requiredPostcoordination ? '(Required)' : '(Optional)';
        const multiple =
          scale.allowMultipleValues === 'true' ? 'Multiple values allowed' : 'Single value only';
        lines.push(`### ${scale.axisName} ${required}`);
        lines.push(`- ${multiple}`);
        if (scale.scaleEntity && scale.scaleEntity.length > 0) {
          lines.push(`- ${scale.scaleEntity.length} possible values`);
        }
        lines.push('');
      }
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      return {
        content: [{ type: 'text', text: `No postcoordination info found for code: ${args.code}` }],
      };
    }
    return handleToolError(error);
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

toolRegistry.register(icd11SearchTool, handleICD11Search);
toolRegistry.register(icd11LookupTool, handleICD11Lookup);
toolRegistry.register(icd11HierarchyTool, handleICD11Hierarchy);
toolRegistry.register(icd11ChaptersTool, handleICD11Chapters);
toolRegistry.register(icd11PostcoordinationTool, handleICD11Postcoordination);
