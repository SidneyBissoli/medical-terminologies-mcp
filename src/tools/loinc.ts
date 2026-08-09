/**
 * LOINC Tools for Medical Terminologies MCP Server
 *
 * - loinc_search: Search for LOINC codes by term
 * - loinc_details: Get detailed information for a LOINC code
 * - loinc_answers: Get answer lists for questionnaire items
 * - loinc_panels: Get panel/form structure for a LOINC code
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/server';
import { toolRegistry } from '../server-core.js';
import { getNLMClient, LOINCItem, LOINCAnswer, LOINCPanel } from '../clients/nlm-client.js';
import {
  LOINCSearchParamsSchema,
  LOINCByCodeParamsSchema,
  LOINCSearchOutputSchema,
  LOINCDetailsOutputSchema,
  LOINCAnswersOutputSchema,
  LOINCPanelsOutputSchema,
  LOINCSearchOutput,
  LOINCDetailsOutput,
  LOINCAnswersOutput,
  LOINCPanelsOutput,
} from '../types/index.js';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
} from '../utils/zod-schema.js';

function loincItemToOutput(item: LOINCItem): LOINCDetailsOutput {
  return {
    loinc_num: item.LOINC_NUM,
    long_common_name: item.LONG_COMMON_NAME,
    short_name: item.SHORTNAME ?? '',
    component: item.COMPONENT ?? '',
    property: item.PROPERTY ?? '',
    time_aspect: item.TIME_ASPCT ?? '',
    system: item.SYSTEM ?? '',
    scale_type: item.SCALE_TYP ?? '',
    method_type: item.METHOD_TYP ?? '',
    class: item.CLASS ?? '',
    status: item.STATUS ?? '',
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

const loincSearchTool: Tool = {
  name: 'loinc_search',
  description: `Search for laboratory tests, clinical observations, and measurements in LOINC (Logical Observation Identifiers Names and Codes).

Use this tool to:
- Find LOINC codes for lab tests (e.g., "glucose", "hemoglobin")
- Search for clinical measurements and vital signs
- Look up diagnostic observations

Returns matching LOINC codes with names, components, and properties.`,
  inputSchema: buildInputSchema(LOINCSearchParamsSchema),
  outputSchema: buildOutputSchema(LOINCSearchOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const loincDetailsTool: Tool = {
  name: 'loinc_details',
  description: `Get detailed information about a specific LOINC code.

Use this tool to:
- Get the full name and description of a LOINC code
- Find the component, property, timing, and system
- Check the scale type and method

Provide a LOINC number in format "XXXXX-X" (e.g., "2339-0" for Glucose).`,
  inputSchema: buildInputSchema(LOINCByCodeParamsSchema),
  outputSchema: buildOutputSchema(LOINCDetailsOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const loincAnswersTool: Tool = {
  name: 'loinc_answers',
  description: `Get the list of valid answers for a LOINC questionnaire item.

Use this tool to:
- Find valid response options for survey questions
- Get answer codes for data entry validation
- Look up standardized answer lists

Only applicable to LOINC codes that represent questions with defined answer sets.`,
  inputSchema: buildInputSchema(LOINCByCodeParamsSchema),
  outputSchema: buildOutputSchema(LOINCAnswersOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const loincPanelsTool: Tool = {
  name: 'loinc_panels',
  description: `Get the structure of a LOINC panel or form.

Use this tool to:
- See all tests included in a panel (e.g., CBC, metabolic panel)
- Get the structure of assessment forms
- Find related observations grouped together

Returns the list of LOINC codes that make up the panel.`,
  inputSchema: buildInputSchema(LOINCByCodeParamsSchema),
  outputSchema: buildOutputSchema(LOINCPanelsOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

// ============================================================================
// Formatters
// ============================================================================

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

async function handleLOINCSearch(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = LOINCSearchParamsSchema.parse(args);
    const client = getNLMClient();
    const results = await client.searchLOINC(params.query, params.max_results);

    const structured: LOINCSearchOutput = {
      query: params.query,
      total_count: results.totalCount,
      shown_count: results.items.length,
      items: results.items.map(loincItemToOutput),
    };

    if (results.items.length === 0) {
      return {
        content: [{ type: 'text', text: `No LOINC codes found for "${params.query}".` }],
        structuredContent: structured,
      };
    }

    const formatted = results.items
      .map((item, index) => formatLOINCItem(item, index))
      .join('\n\n');

    const header = `## LOINC Search Results for "${params.query}"\n\nFound ${results.totalCount} total results (showing ${results.items.length}):\n\n`;

    return {
      content: [{ type: 'text', text: header + formatted }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleLOINCDetails(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = LOINCByCodeParamsSchema.parse(args);
    const client = getNLMClient();
    const item = await client.getLOINCDetails(params.loinc_num);

    if (!item) {
      return {
        content: [{
          type: 'text',
          text: `LOINC code "${params.loinc_num}" not found. Please verify the code is correct.`,
        }],
        isError: true,
      };
    }

    const structured: LOINCDetailsOutput = loincItemToOutput(item);

    return {
      content: [{ type: 'text', text: formatLOINCDetails(item) }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleLOINCAnswers(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = LOINCByCodeParamsSchema.parse(args);
    const client = getNLMClient();
    const answers = await client.getLOINCAnswers(params.loinc_num);

    const structured: LOINCAnswersOutput = {
      loinc_num: params.loinc_num,
      answers: answers.map((a) => ({
        sequence: a.sequence,
        answer_code: a.answerCode,
        answer_string: a.answerString,
      })),
    };

    return {
      content: [{ type: 'text', text: formatLOINCAnswers(params.loinc_num, answers) }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleLOINCPanels(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = LOINCByCodeParamsSchema.parse(args);
    const client = getNLMClient();
    const panel = await client.getLOINCPanel(params.loinc_num);

    const structured: LOINCPanelsOutput = {
      loinc_num: params.loinc_num,
      panel: panel
        ? {
            loinc_num: panel.loincNum,
            name: panel.name,
            items: panel.items.map((it) => ({
              sequence: it.sequence,
              loinc_num: it.loincNum,
              name: it.name,
              required: it.required,
            })),
          }
        : null,
    };

    return {
      content: [{ type: 'text', text: formatLOINCPanel(panel, params.loinc_num) }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

toolRegistry.register(loincSearchTool, handleLOINCSearch);
toolRegistry.register(loincDetailsTool, handleLOINCDetails);
toolRegistry.register(loincAnswersTool, handleLOINCAnswers);
toolRegistry.register(loincPanelsTool, handleLOINCPanels);
