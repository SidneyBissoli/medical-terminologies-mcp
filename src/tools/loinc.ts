/**
 * LOINC Tools for Medical Terminologies MCP Server
 *
 * Provides access to LOINC (Logical Observation Identifiers Names and Codes)
 * through the following tools:
 * - loinc_search: Search for LOINC codes by term
 * - loinc_details: Get detailed information for a LOINC code
 * - loinc_answers: Get answer lists for questionnaire items
 * - loinc_panels: Get panel/form structure for a LOINC code
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toolRegistry } from '../server.js';
import { getNLMClient, LOINCItem, LOINCAnswer, LOINCPanel } from '../clients/nlm-client.js';
import { ApiError } from '../types/index.js';
import { createToolLogger } from '../utils/logger.js';

const log = createToolLogger('loinc');

// ============================================================================
// Zod Schemas
// ============================================================================

const LOINCSearchParamsSchema = z.object({
  query: z.string().min(1).describe('Search term (test name, keyword, or LOINC code)'),
  maxResults: z.number().int().min(1).max(100).optional().default(25).describe('Maximum results'),
});

const LOINCDetailsParamsSchema = z.object({
  loincNum: z.string().min(1).describe('LOINC number (e.g., "2339-0")'),
});

const LOINCAnswersParamsSchema = z.object({
  loincNum: z.string().min(1).describe('LOINC number for questionnaire item'),
});

const LOINCPanelsParamsSchema = z.object({
  loincNum: z.string().min(1).describe('LOINC number for panel/form'),
});

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * loinc_search tool definition
 */
const loincSearchTool: Tool = {
  name: 'loinc_search',
  description: `Search for laboratory tests, clinical observations, and measurements in LOINC (Logical Observation Identifiers Names and Codes).

Use this tool to:
- Find LOINC codes for lab tests (e.g., "glucose", "hemoglobin")
- Search for clinical measurements and vital signs
- Look up diagnostic observations

Returns matching LOINC codes with names, components, and properties.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search term (test name, keyword, or partial LOINC code)',
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
 * loinc_details tool definition
 */
const loincDetailsTool: Tool = {
  name: 'loinc_details',
  description: `Get detailed information about a specific LOINC code.

Use this tool to:
- Get the full name and description of a LOINC code
- Find the component, property, timing, and system
- Check the scale type and method

Provide a LOINC number in format "XXXXX-X" (e.g., "2339-0" for Glucose).`,
  inputSchema: {
    type: 'object',
    properties: {
      loinc_num: {
        type: 'string',
        description: 'LOINC number (e.g., "2339-0")',
      },
    },
    required: ['loinc_num'],
  },
};

/**
 * loinc_answers tool definition
 */
const loincAnswersTool: Tool = {
  name: 'loinc_answers',
  description: `Get the list of valid answers for a LOINC questionnaire item.

Use this tool to:
- Find valid response options for survey questions
- Get answer codes for data entry validation
- Look up standardized answer lists

Only applicable to LOINC codes that represent questions with defined answer sets.`,
  inputSchema: {
    type: 'object',
    properties: {
      loinc_num: {
        type: 'string',
        description: 'LOINC number for the questionnaire item',
      },
    },
    required: ['loinc_num'],
  },
};

/**
 * loinc_panels tool definition
 */
const loincPanelsTool: Tool = {
  name: 'loinc_panels',
  description: `Get the structure of a LOINC panel or form.

Use this tool to:
- See all tests included in a panel (e.g., CBC, metabolic panel)
- Get the structure of assessment forms
- Find related observations grouped together

Returns the list of LOINC codes that make up the panel.`,
  inputSchema: {
    type: 'object',
    properties: {
      loinc_num: {
        type: 'string',
        description: 'LOINC number for the panel or form',
      },
    },
    required: ['loinc_num'],
  },
};

// ============================================================================
// Formatters
// ============================================================================

/**
 * Formats a LOINC item for display
 */
function formatLOINCItem(item: LOINCItem, index?: number): string {
  const lines: string[] = [];
  const prefix = index !== undefined ? `${index + 1}. ` : '';

  lines.push(`${prefix}**${item.LOINC_NUM}** - ${item.LONG_COMMON_NAME || item.SHORTNAME}`);

  const details: string[] = [];
  if (item.COMPONENT) details.push(`Component: ${item.COMPONENT}`);
  if (item.PROPERTY) details.push(`Property: ${item.PROPERTY}`);
  if (item.TIME_ASPCT) details.push(`Timing: ${item.TIME_ASPCT}`);
  if (item.SYSTEM) details.push(`System: ${item.SYSTEM}`);
  if (item.SCALE_TYP) details.push(`Scale: ${item.SCALE_TYP}`);
  if (item.METHOD_TYP) details.push(`Method: ${item.METHOD_TYP}`);

  if (details.length > 0) {
    lines.push(`   ${details.join(' | ')}`);
  }

  if (item.CLASS) {
    lines.push(`   Class: ${item.CLASS} | Status: ${item.STATUS || 'Active'}`);
  }

  return lines.join('\n');
}

/**
 * Formats LOINC item details for display
 */
function formatLOINCDetails(item: LOINCItem): string {
  const lines: string[] = [];

  lines.push(`# ${item.LOINC_NUM} - ${item.LONG_COMMON_NAME}`);
  lines.push('');

  if (item.SHORTNAME) {
    lines.push(`**Short Name:** ${item.SHORTNAME}`);
  }

  lines.push('');
  lines.push('## Attributes');
  lines.push('');
  lines.push(`| Attribute | Value |`);
  lines.push(`|-----------|-------|`);
  lines.push(`| Component | ${item.COMPONENT || 'N/A'} |`);
  lines.push(`| Property | ${item.PROPERTY || 'N/A'} |`);
  lines.push(`| Timing | ${item.TIME_ASPCT || 'N/A'} |`);
  lines.push(`| System | ${item.SYSTEM || 'N/A'} |`);
  lines.push(`| Scale Type | ${item.SCALE_TYP || 'N/A'} |`);
  lines.push(`| Method | ${item.METHOD_TYP || 'N/A'} |`);
  lines.push(`| Class | ${item.CLASS || 'N/A'} |`);
  lines.push(`| Status | ${item.STATUS || 'Active'} |`);

  return lines.join('\n');
}

/**
 * Formats LOINC answers for display
 */
function formatLOINCAnswers(loincNum: string, answers: LOINCAnswer[]): string {
  const lines: string[] = [];

  lines.push(`# Answers for ${loincNum}`);
  lines.push('');

  if (answers.length === 0) {
    lines.push('No predefined answers available for this LOINC code.');
    lines.push('');
    lines.push('This may mean:');
    lines.push('- The code represents a numeric measurement (not a questionnaire)');
    lines.push('- The code has free-text responses');
    lines.push('- Answer list is not defined in LOINC');
  } else {
    lines.push(`Found ${answers.length} answer(s):`);
    lines.push('');
    lines.push('| # | Code | Answer |');
    lines.push('|---|------|--------|');

    for (const answer of answers) {
      lines.push(`| ${answer.sequence} | ${answer.answerCode} | ${answer.answerString} |`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats LOINC panel for display
 */
function formatLOINCPanel(panel: LOINCPanel | null, loincNum: string): string {
  const lines: string[] = [];

  if (!panel) {
    lines.push(`# Panel Information for ${loincNum}`);
    lines.push('');
    lines.push('No panel structure found for this LOINC code.');
    lines.push('');
    lines.push('This may mean:');
    lines.push('- The code is not a panel/form');
    lines.push('- The code represents an individual observation');
    lines.push('- Panel definition is not available');
    return lines.join('\n');
  }

  lines.push(`# ${panel.name}`);
  lines.push(`LOINC: ${panel.loincNum}`);
  lines.push('');
  lines.push(`## Panel Members (${panel.items.length} items)`);
  lines.push('');

  if (panel.items.length > 0) {
    lines.push('| # | LOINC | Name | Required |');
    lines.push('|---|-------|------|----------|');

    for (const item of panel.items) {
      const req = item.required ? 'Yes' : 'No';
      lines.push(`| ${item.sequence} | ${item.loincNum} | ${item.name} | ${req} |`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Handler for loinc_search
 */
async function handleLOINCSearch(args: Record<string, unknown>): Promise<CallToolResult> {
  const startTime = Date.now();
  log.debug({ tool: 'loinc_search', args }, 'Tool invocation started');

  try {
    const params = LOINCSearchParamsSchema.parse({
      query: args.query,
      maxResults: args.max_results ?? 25,
    });

    const client = getNLMClient();
    const results = await client.searchLOINC(params.query, params.maxResults);

    if (results.items.length === 0) {
      const duration = Date.now() - startTime;
      log.info({ tool: 'loinc_search', durationMs: duration, resultCount: 0 }, 'Tool invocation completed');
      return {
        content: [{
          type: 'text',
          text: `No LOINC codes found for "${params.query}".`,
        }],
      };
    }

    const formatted = results.items
      .map((item, index) => formatLOINCItem(item, index))
      .join('\n\n');

    const header = `## LOINC Search Results for "${params.query}"\n\nFound ${results.totalCount} total results (showing ${results.items.length}):\n\n`;

    const duration = Date.now() - startTime;
    log.info({ tool: 'loinc_search', durationMs: duration, resultCount: results.items.length }, 'Tool invocation completed');

    return {
      content: [{
        type: 'text',
        text: header + formatted,
      }],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ tool: 'loinc_search', durationMs: duration, error: errorMessage }, 'Tool invocation failed');

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
 * Handler for loinc_details
 */
async function handleLOINCDetails(args: Record<string, unknown>): Promise<CallToolResult> {
  const startTime = Date.now();
  log.debug({ tool: 'loinc_details', args }, 'Tool invocation started');

  try {
    const params = LOINCDetailsParamsSchema.parse({
      loincNum: args.loinc_num,
    });

    const client = getNLMClient();
    const item = await client.getLOINCDetails(params.loincNum);

    if (!item) {
      const duration = Date.now() - startTime;
      log.info({ tool: 'loinc_details', durationMs: duration, loincNum: params.loincNum, found: false }, 'Tool invocation completed');
      return {
        content: [{
          type: 'text',
          text: `LOINC code "${params.loincNum}" not found. Please verify the code is correct.`,
        }],
        isError: true,
      };
    }

    const duration = Date.now() - startTime;
    log.info({ tool: 'loinc_details', durationMs: duration, loincNum: params.loincNum, found: true }, 'Tool invocation completed');

    return {
      content: [{
        type: 'text',
        text: formatLOINCDetails(item),
      }],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ tool: 'loinc_details', durationMs: duration, error: errorMessage }, 'Tool invocation failed');

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
 * Handler for loinc_answers
 */
async function handleLOINCAnswers(args: Record<string, unknown>): Promise<CallToolResult> {
  const startTime = Date.now();
  log.debug({ tool: 'loinc_answers', args }, 'Tool invocation started');

  try {
    const params = LOINCAnswersParamsSchema.parse({
      loincNum: args.loinc_num,
    });

    const client = getNLMClient();
    const answers = await client.getLOINCAnswers(params.loincNum);

    const duration = Date.now() - startTime;
    log.info({ tool: 'loinc_answers', durationMs: duration, loincNum: params.loincNum, answerCount: answers.length }, 'Tool invocation completed');

    return {
      content: [{
        type: 'text',
        text: formatLOINCAnswers(params.loincNum, answers),
      }],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ tool: 'loinc_answers', durationMs: duration, error: errorMessage }, 'Tool invocation failed');

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
 * Handler for loinc_panels
 */
async function handleLOINCPanels(args: Record<string, unknown>): Promise<CallToolResult> {
  const startTime = Date.now();
  log.debug({ tool: 'loinc_panels', args }, 'Tool invocation started');

  try {
    const params = LOINCPanelsParamsSchema.parse({
      loincNum: args.loinc_num,
    });

    const client = getNLMClient();
    const panel = await client.getLOINCPanel(params.loincNum);

    const duration = Date.now() - startTime;
    log.info({ tool: 'loinc_panels', durationMs: duration, loincNum: params.loincNum, itemCount: panel?.items.length || 0 }, 'Tool invocation completed');

    return {
      content: [{
        type: 'text',
        text: formatLOINCPanel(panel, params.loincNum),
      }],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ tool: 'loinc_panels', durationMs: duration, error: errorMessage }, 'Tool invocation failed');

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

// ============================================================================
// Tool Registration (executed at module load time)
// ============================================================================

// Register all LOINC tools immediately when this module is imported
toolRegistry.register(loincSearchTool, handleLOINCSearch);
toolRegistry.register(loincDetailsTool, handleLOINCDetails);
toolRegistry.register(loincAnswersTool, handleLOINCAnswers);
toolRegistry.register(loincPanelsTool, handleLOINCPanels);
