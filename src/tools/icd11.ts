/**
 * ICD-11 Tools for Medical Terminologies MCP Server
 *
 * Provides access to WHO's ICD-11 (International Classification of Diseases, 11th Revision)
 * through the following tools:
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
import { z } from 'zod';
import { toolRegistry } from '../server.js';
import { getWHOClient, ICD11DestinationEntity, ICD11EntityResponse } from '../clients/who-client.js';
import {
  ICD11SearchParamsSchema,
  ICD11HierarchyParamsSchema,
  ICD11ChaptersParamsSchema,
  ApiError,
} from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('icd11-tools');

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * icd11_search tool definition
 */
const icd11SearchTool: Tool = {
  name: 'icd11_search',
  description: `Search for medical conditions, diseases, and health problems in ICD-11 (International Classification of Diseases, 11th Revision).

Use this tool to:
- Find ICD-11 codes for diagnoses
- Search for diseases by name or keyword
- Look up conditions in multiple languages

Returns matching entities with codes, titles, and relevance scores.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search text (disease name, symptom, or keyword)',
      },
      language: {
        type: 'string',
        description: 'Language code (en, es, pt, fr, de, etc.). Default: en',
        enum: ['en', 'es', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ar', 'ru'],
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results (1-100). Default: 25',
        minimum: 1,
        maximum: 100,
      },
    },
    required: ['query'],
  },
};

/**
 * icd11_lookup tool definition
 */
const icd11LookupTool: Tool = {
  name: 'icd11_lookup',
  description: `Get detailed information about a specific ICD-11 entity by code or URI.

Use this tool to:
- Get the full definition of a disease
- Retrieve coding notes and exclusions
- Get the official title and synonyms

Provide either an ICD-11 code (e.g., "BA00") or a full foundation URI.`,
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'ICD-11 code (e.g., "BA00", "1A00")',
      },
      uri: {
        type: 'string',
        description: 'Full ICD-11 foundation URI',
      },
      language: {
        type: 'string',
        description: 'Language code. Default: en',
        enum: ['en', 'es', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ar', 'ru'],
      },
    },
  },
};

/**
 * icd11_hierarchy tool definition
 */
const icd11HierarchyTool: Tool = {
  name: 'icd11_hierarchy',
  description: `Navigate the ICD-11 hierarchy to find parent or child entities.

Use this tool to:
- Find broader categories (parents) of a condition
- Find specific subtypes (children) of a condition
- Understand the classification structure

Direction 'parents' returns ancestor categories, 'children' returns subcategories.`,
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'ICD-11 code to get hierarchy for',
      },
      direction: {
        type: 'string',
        description: 'Direction: "parents" for ancestors, "children" for subtypes',
        enum: ['parents', 'children'],
      },
    },
    required: ['code', 'direction'],
  },
};

/**
 * icd11_chapters tool definition
 */
const icd11ChaptersTool: Tool = {
  name: 'icd11_chapters',
  description: `List all ICD-11 chapters (top-level categories).

Use this tool to:
- Get an overview of ICD-11 structure
- Find which chapter covers a body system or condition type
- Navigate to specific disease categories

ICD-11 has 28 chapters covering all areas of medicine.`,
  inputSchema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Language code. Default: en',
        enum: ['en', 'es', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ar', 'ru'],
      },
    },
  },
};

/**
 * icd11_postcoordination tool definition
 */
const icd11PostcoordinationTool: Tool = {
  name: 'icd11_postcoordination',
  description: `Get postcoordination information for an ICD-11 code.

Use this tool to:
- Find available axes for building composite codes
- Check required vs optional postcoordination
- Understand code extension possibilities

Postcoordination allows adding severity, laterality, anatomy, etc.`,
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'ICD-11 code to get postcoordination info for',
      },
    },
    required: ['code'],
  },
};

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Formats a search result entity for display
 */
function formatSearchResult(entity: ICD11DestinationEntity, index: number): string {
  const lines: string[] = [];
  lines.push(`${index + 1}. **${entity.theCode || 'No code'}** - ${entity.title}`);

  if (entity.matchingPVs && entity.matchingPVs.length > 0) {
    const matches = entity.matchingPVs.map(pv => pv.label).join(', ');
    lines.push(`   Matches: ${matches}`);
  }

  lines.push(`   Score: ${entity.score.toFixed(2)} | Leaf: ${entity.isLeaf ? 'Yes' : 'No'}`);

  return lines.join('\n');
}

/**
 * Formats an entity for display
 */
function formatEntity(entity: ICD11EntityResponse): string {
  const lines: string[] = [];

  // Title and code
  const title = entity.title?.['@value'] || 'Unknown';
  const code = entity.code || entity.codeRange || 'No code';
  lines.push(`# ${code} - ${title}`);
  lines.push('');

  // Definition
  if (entity.definition?.['@value']) {
    lines.push(`**Definition:** ${entity.definition['@value']}`);
    lines.push('');
  }

  // Long definition
  if (entity.longDefinition?.['@value']) {
    lines.push(`**Detailed Description:** ${entity.longDefinition['@value']}`);
    lines.push('');
  }

  // Diagnostic criteria
  if (entity.diagnosticCriteria?.['@value']) {
    lines.push(`**Diagnostic Criteria:** ${entity.diagnosticCriteria['@value']}`);
    lines.push('');
  }

  // Coding note
  if (entity.codingNote?.['@value']) {
    lines.push(`**Coding Note:** ${entity.codingNote['@value']}`);
    lines.push('');
  }

  // Exclusions
  if (entity.exclusion && entity.exclusion.length > 0) {
    lines.push('**Exclusions:**');
    for (const exc of entity.exclusion) {
      const label = exc.label?.['@value'] || exc['@id'];
      lines.push(`- ${label}`);
    }
    lines.push('');
  }

  // Inclusions
  if (entity.inclusion && entity.inclusion.length > 0) {
    lines.push('**Inclusions (Synonyms):**');
    for (const inc of entity.inclusion) {
      const label = inc.label?.['@value'] || inc['@id'];
      lines.push(`- ${label}`);
    }
    lines.push('');
  }

  // Index terms
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

  // Browser URL
  if (entity.browserUrl) {
    lines.push(`**Browser:** ${entity.browserUrl}`);
  }

  return lines.join('\n');
}

/**
 * Formats a list of entities for hierarchy display
 */
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

/**
 * Handler for icd11_search
 */
async function handleICD11Search(args: Record<string, unknown>): Promise<CallToolResult> {
  const startTime = Date.now();
  log.debug({ tool: 'icd11_search', args }, 'Tool invocation started');

  try {
    const params = ICD11SearchParamsSchema.parse({
      query: args.query,
      language: args.language ?? 'en',
      maxResults: args.max_results ?? 25,
    });

    const client = getWHOClient();
    const results = await client.search(params.query, params.language, params.maxResults);

    if (results.error) {
      return {
        content: [{
          type: 'text',
          text: `Search error: ${results.errorMessage || 'Unknown error'}`,
        }],
        isError: true,
      };
    }

    if (!results.destinationEntities || results.destinationEntities.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No results found for "${params.query}" in ICD-11.`,
        }],
      };
    }

    const formatted = results.destinationEntities
      .slice(0, params.maxResults)
      .map((entity, index) => formatSearchResult(entity, index))
      .join('\n\n');

    const header = `## ICD-11 Search Results for "${params.query}"\n\nFound ${results.destinationEntities.length} results (showing top ${Math.min(params.maxResults, results.destinationEntities.length)}):\n\n`;

    const duration = Date.now() - startTime;
    log.info({ tool: 'icd11_search', durationMs: duration, resultCount: results.destinationEntities.length }, 'Tool invocation completed');

    return {
      content: [{
        type: 'text',
        text: header + formatted,
      }],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ tool: 'icd11_search', durationMs: duration, error: errorMessage }, 'Tool invocation failed');

    if (error instanceof z.ZodError) {
      return {
        content: [{
          type: 'text',
          text: `Validation error: ${error.errors.map(e => e.message).join(', ')}`,
        }],
        isError: true,
      };
    }
    if (error instanceof ApiError) {
      return {
        content: [{
          type: 'text',
          text: `API error (${error.code}): ${error.message}`,
        }],
        isError: true,
      };
    }
    throw error;
  }
}

/**
 * Handler for icd11_lookup
 */
async function handleICD11Lookup(args: Record<string, unknown>): Promise<CallToolResult> {
  const startTime = Date.now();
  log.debug({ tool: 'icd11_lookup', args }, 'Tool invocation started');

  try {
    // Validate that at least one of code or uri is provided
    if (!args.code && !args.uri) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Either "code" or "uri" must be provided.',
        }],
        isError: true,
      };
    }

    const language = (args.language as string) ?? 'en';
    const codeOrUri = (args.code || args.uri) as string;

    const client = getWHOClient();
    const entity = await client.lookup(codeOrUri, language);

    const duration = Date.now() - startTime;
    log.info({ tool: 'icd11_lookup', durationMs: duration, code: codeOrUri }, 'Tool invocation completed');

    return {
      content: [{
        type: 'text',
        text: formatEntity(entity),
      }],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ tool: 'icd11_lookup', durationMs: duration, error: errorMessage }, 'Tool invocation failed');

    if (error instanceof ApiError) {
      if (error.code === 'NOT_FOUND') {
        return {
          content: [{
            type: 'text',
            text: `Entity not found: ${args.code || args.uri}. Please verify the code is correct.`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: `API error (${error.code}): ${error.message}`,
        }],
        isError: true,
      };
    }
    throw error;
  }
}

/**
 * Handler for icd11_hierarchy
 */
async function handleICD11Hierarchy(args: Record<string, unknown>): Promise<CallToolResult> {
  const startTime = Date.now();
  log.debug({ tool: 'icd11_hierarchy', args }, 'Tool invocation started');

  try {
    const params = ICD11HierarchyParamsSchema.parse({
      code: args.code,
      direction: args.direction,
    });

    const client = getWHOClient();

    let entities: ICD11EntityResponse[];
    if (params.direction === 'parents') {
      entities = await client.getParents(params.code);
    } else {
      entities = await client.getChildren(params.code);
    }

    const formatted = formatHierarchyList(entities, params.direction);

    const duration = Date.now() - startTime;
    log.info({ tool: 'icd11_hierarchy', durationMs: duration, code: params.code, direction: params.direction, resultCount: entities.length }, 'Tool invocation completed');

    return {
      content: [{
        type: 'text',
        text: `## ICD-11 Hierarchy for ${params.code}\n\n${formatted}`,
      }],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ tool: 'icd11_hierarchy', durationMs: duration, error: errorMessage }, 'Tool invocation failed');

    if (error instanceof z.ZodError) {
      return {
        content: [{
          type: 'text',
          text: `Validation error: ${error.errors.map(e => e.message).join(', ')}`,
        }],
        isError: true,
      };
    }
    if (error instanceof ApiError) {
      return {
        content: [{
          type: 'text',
          text: `API error (${error.code}): ${error.message}`,
        }],
        isError: true,
      };
    }
    throw error;
  }
}

/**
 * Handler for icd11_chapters
 */
async function handleICD11Chapters(args: Record<string, unknown>): Promise<CallToolResult> {
  const startTime = Date.now();
  log.debug({ tool: 'icd11_chapters', args }, 'Tool invocation started');

  try {
    const params = ICD11ChaptersParamsSchema.parse({
      language: args.language ?? 'en',
    });

    const client = getWHOClient();
    const chaptersResponse = await client.getChapters(params.language);

    if (!chaptersResponse.child || chaptersResponse.child.length === 0) {
      const duration = Date.now() - startTime;
      log.info({ tool: 'icd11_chapters', durationMs: duration, resultCount: 0 }, 'Tool invocation completed');
      return {
        content: [{
          type: 'text',
          text: 'No chapters found in ICD-11.',
        }],
      };
    }

    // Fetch details for each chapter
    const lines: string[] = [];
    lines.push('# ICD-11 Chapters');
    lines.push('');
    lines.push('The International Classification of Diseases, 11th Revision (ICD-11) is organized into the following chapters:');
    lines.push('');

    let chapterNum = 1;
    for (const chapterUri of chaptersResponse.child) {
      try {
        const chapter = await client.getEntity(chapterUri, params.language);
        const title = chapter.title?.['@value'] || 'Unknown';
        const code = chapter.code || chapter.codeRange || '';
        lines.push(`${chapterNum}. **${code}** - ${title}`);
        chapterNum++;
      } catch {
        lines.push(`${chapterNum}. (Unable to load chapter)`);
        chapterNum++;
      }
    }

    const duration = Date.now() - startTime;
    log.info({ tool: 'icd11_chapters', durationMs: duration, resultCount: chaptersResponse.child.length }, 'Tool invocation completed');

    return {
      content: [{
        type: 'text',
        text: lines.join('\n'),
      }],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ tool: 'icd11_chapters', durationMs: duration, error: errorMessage }, 'Tool invocation failed');

    if (error instanceof ApiError) {
      return {
        content: [{
          type: 'text',
          text: `API error (${error.code}): ${error.message}`,
        }],
        isError: true,
      };
    }
    throw error;
  }
}

/**
 * Handler for icd11_postcoordination
 */
async function handleICD11Postcoordination(args: Record<string, unknown>): Promise<CallToolResult> {
  const startTime = Date.now();
  log.debug({ tool: 'icd11_postcoordination', args }, 'Tool invocation started');

  try {
    const code = args.code as string;
    if (!code) {
      return {
        content: [{
          type: 'text',
          text: 'Error: "code" parameter is required.',
        }],
        isError: true,
      };
    }

    const client = getWHOClient();
    const postcoord = await client.getPostcoordination(code);

    const lines: string[] = [];
    lines.push(`# Postcoordination for ${code}`);
    lines.push('');

    if (!postcoord.postcoordinationScale || postcoord.postcoordinationScale.length === 0) {
      lines.push('This entity does not have postcoordination axes available.');
    } else {
      lines.push('**Available Postcoordination Axes:**');
      lines.push('');

      for (const scale of postcoord.postcoordinationScale) {
        const required = scale.requiredPostcoordination ? '(Required)' : '(Optional)';
        const multiple = scale.allowMultipleValues === 'true' ? 'Multiple values allowed' : 'Single value only';
        lines.push(`### ${scale.axisName} ${required}`);
        lines.push(`- ${multiple}`);
        if (scale.scaleEntity && scale.scaleEntity.length > 0) {
          lines.push(`- ${scale.scaleEntity.length} possible values`);
        }
        lines.push('');
      }
    }

    const duration = Date.now() - startTime;
    const axesCount = postcoord.postcoordinationScale?.length || 0;
    log.info({ tool: 'icd11_postcoordination', durationMs: duration, code, axesCount }, 'Tool invocation completed');

    return {
      content: [{
        type: 'text',
        text: lines.join('\n'),
      }],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ tool: 'icd11_postcoordination', durationMs: duration, error: errorMessage }, 'Tool invocation failed');

    if (error instanceof ApiError) {
      if (error.code === 'NOT_FOUND') {
        return {
          content: [{
            type: 'text',
            text: `No postcoordination info found for code: ${args.code}`,
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: `API error (${error.code}): ${error.message}`,
        }],
        isError: true,
      };
    }
    throw error;
  }
}

// ============================================================================
// Tool Registration (executed at module load time)
// ============================================================================

// Register all ICD-11 tools immediately when this module is imported
toolRegistry.register(icd11SearchTool, handleICD11Search);
toolRegistry.register(icd11LookupTool, handleICD11Lookup);
toolRegistry.register(icd11HierarchyTool, handleICD11Hierarchy);
toolRegistry.register(icd11ChaptersTool, handleICD11Chapters);
toolRegistry.register(icd11PostcoordinationTool, handleICD11Postcoordination);

/**
 * Registers all ICD-11 tools with the tool registry
 * @deprecated Tools are now registered automatically on module import
 */
export function registerICD11Tools(): void {
  // Tools are already registered at module load time
  // This function is kept for backwards compatibility
}
