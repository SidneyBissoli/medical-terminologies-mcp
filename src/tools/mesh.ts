/**
 * MeSH Tools for Medical Terminologies MCP Server
 *
 * - mesh_search: Search descriptors by term
 * - mesh_descriptor: Get descriptor details by ID
 * - mesh_tree: Get tree hierarchy for a descriptor
 * - mesh_qualifiers: Get allowed qualifiers for a descriptor
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/server';
import { toolRegistry } from '../server-core.js';
import {
  getMeSHClient,
  MeSHSearchResult,
  MeSHDescriptor,
  MeSHTreeNumber,
  MeSHQualifier,
} from '../clients/mesh-client.js';
import {
  MeSHSearchParamsSchema,
  MeSHByIdParamsSchema,
  MeSHDescriptorParamsSchema,
  MeSHSearchOutputSchema,
  MeSHDescriptorOutputSchema,
  MeSHTreeOutputSchema,
  MeSHQualifiersOutputSchema,
  MeSHSearchOutput,
  MeSHDescriptorOutput,
  MeSHTreeOutput,
  MeSHQualifiersOutput,
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

const meshSearchTool: Tool = {
  name: 'mesh_search',
  title: 'Search MeSH',
  description: `Search for MeSH (Medical Subject Headings) descriptors.

Use this tool to:
- Find MeSH terms for indexing medical literature
- Look up subject headings for PubMed searches
- Find controlled vocabulary terms

Set \`language\` to request NLM's official translations where they exist (e.g. \`language: "pt"\` for Portuguese labels); content is never machine-translated.

Returns matching descriptors with MeSH IDs and labels.`,
  inputSchema: buildInputSchema(MeSHSearchParamsSchema),
  outputSchema: buildOutputSchema(MeSHSearchOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const meshDescriptorTool: Tool = {
  name: 'mesh_descriptor',
  title: 'MeSH Descriptor Details',
  description: `Get detailed information about a MeSH descriptor by ID.

Use this tool to:
- Get the full definition (scope note) of a MeSH term
- View tree numbers showing hierarchy location
- See related concepts and synonyms

Provide a MeSH Descriptor ID like "D015242" (Ofloxacin). Set \`language\` to request NLM's official translations where they exist (e.g. \`language: "pt"\`).`,
  inputSchema: buildInputSchema(MeSHDescriptorParamsSchema),
  outputSchema: buildOutputSchema(MeSHDescriptorOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const meshTreeTool: Tool = {
  name: 'mesh_tree',
  title: 'MeSH Tree Locations',
  description: `Get the tree hierarchy location(s) for a MeSH descriptor.

Use this tool to:
- See where a term fits in the MeSH hierarchy
- Understand broader/narrower relationships
- Find related terms in the same branch

MeSH tree numbers show the hierarchical path (e.g., C14.280.647 for Myocardial Infarction).`,
  inputSchema: buildInputSchema(MeSHByIdParamsSchema),
  outputSchema: buildOutputSchema(MeSHTreeOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const meshQualifiersTool: Tool = {
  name: 'mesh_qualifiers',
  title: 'MeSH Allowable Qualifiers',
  description: `Get allowed qualifiers (subheadings) for a MeSH descriptor.

Use this tool to:
- Find which qualifiers can be combined with a descriptor
- Build precise MeSH search queries
- Understand aspects that can be specified

Qualifiers refine descriptors (e.g., "Diabetes Mellitus/drug therapy").`,
  inputSchema: buildInputSchema(MeSHByIdParamsSchema),
  outputSchema: buildOutputSchema(MeSHQualifiersOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

// ============================================================================
// Formatters
// ============================================================================

function formatSearchResults(query: string, results: MeSHSearchResult[]): string {
  const lines: string[] = [];

  lines.push(`## MeSH Search Results for "${query}"`);
  lines.push('');

  if (results.length === 0) {
    lines.push('No descriptors found.');
    return lines.join('\n');
  }

  lines.push(`Found ${results.length} descriptor(s):`);
  lines.push('');
  lines.push('| MeSH ID | Label |');
  lines.push('|---------|-------|');

  for (const result of results) {
    lines.push(`| ${result.id} | ${result.label} |`);
  }

  return lines.join('\n');
}

function formatDescriptor(descriptor: MeSHDescriptor): string {
  const lines: string[] = [];

  lines.push(`# ${descriptor.label}`);
  lines.push(`MeSH ID: ${descriptor.id}`);
  lines.push('');

  if (descriptor.scopeNote) {
    lines.push('## Scope Note');
    lines.push('');
    lines.push(descriptor.scopeNote);
    lines.push('');
  }

  if (descriptor.treeNumbers.length > 0) {
    lines.push('## Tree Numbers');
    lines.push('');
    for (const tn of descriptor.treeNumbers) {
      lines.push(`- ${tn.treeNumber}`);
    }
    lines.push('');
  }

  if (descriptor.concepts.length > 0) {
    lines.push('## Concepts');
    lines.push('');
    for (const concept of descriptor.concepts) {
      const preferred = concept.isPreferred ? ' *(preferred)*' : '';
      lines.push(`- ${concept.label}${preferred}`);
    }
    lines.push('');
  }

  if (descriptor.qualifiers.length > 0) {
    lines.push('## Allowed Qualifiers');
    lines.push('');
    lines.push(`${descriptor.qualifiers.length} qualifier(s) allowed. Use mesh_qualifiers for details.`);
  }

  return lines.join('\n');
}

function formatTreeNumbers(meshId: string, treeNumbers: MeSHTreeNumber[]): string {
  const lines: string[] = [];

  lines.push(`# Tree Numbers for ${meshId}`);
  lines.push('');

  if (treeNumbers.length === 0) {
    lines.push('No tree numbers found for this descriptor.');
    return lines.join('\n');
  }

  lines.push(`Found ${treeNumbers.length} tree location(s):`);
  lines.push('');

  const categories: Record<string, string[]> = {};

  for (const tn of treeNumbers) {
    const topLevel = tn.treeNumber.split('.')[0];
    const categoryName = getMeSHCategoryName(topLevel);

    if (!categories[categoryName]) {
      categories[categoryName] = [];
    }
    categories[categoryName].push(tn.treeNumber);
  }

  for (const [category, numbers] of Object.entries(categories)) {
    lines.push(`### ${category}`);
    lines.push('');
    for (const num of numbers) {
      lines.push(`- \`${num}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function getMeSHCategoryName(prefix: string): string {
  const categories: Record<string, string> = {
    'A': 'Anatomy',
    'B': 'Organisms',
    'C': 'Diseases',
    'D': 'Chemicals and Drugs',
    'E': 'Analytical, Diagnostic and Therapeutic Techniques',
    'F': 'Psychiatry and Psychology',
    'G': 'Phenomena and Processes',
    'H': 'Disciplines and Occupations',
    'I': 'Anthropology, Education, Sociology',
    'J': 'Technology, Industry, Agriculture',
    'K': 'Humanities',
    'L': 'Information Science',
    'M': 'Named Groups',
    'N': 'Health Care',
    'V': 'Publication Characteristics',
    'Z': 'Geographicals',
  };

  const letter = prefix.charAt(0);
  return categories[letter] || `Category ${letter}`;
}

function formatQualifiers(meshId: string, qualifiers: MeSHQualifier[]): string {
  const lines: string[] = [];

  lines.push(`# Allowed Qualifiers for ${meshId}`);
  lines.push('');

  if (qualifiers.length === 0) {
    lines.push('No qualifiers found for this descriptor.');
    lines.push('');
    lines.push('This may mean:');
    lines.push('- The descriptor does not allow qualifiers');
    lines.push('- The descriptor ID is invalid');
    return lines.join('\n');
  }

  lines.push(`Found ${qualifiers.length} allowed qualifier(s):`);
  lines.push('');
  lines.push('| Qualifier ID | Label |');
  lines.push('|--------------|-------|');

  for (const qual of qualifiers) {
    lines.push(`| ${qual.id} | ${qual.label} |`);
  }

  lines.push('');
  lines.push('*Use qualifiers with descriptors like: "Diabetes Mellitus/therapy"*');

  return lines.join('\n');
}

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleMeSHSearch(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MeSHSearchParamsSchema.parse(args);
    const client = getMeSHClient();
    const results = await client.searchDescriptors(
      params.query,
      params.match,
      params.max_results,
      params.language,
    );

    const structured: MeSHSearchOutput = {
      query: params.query,
      match: params.match,
      total_count: results.length,
      descriptors: results.map((r) => ({
        id: r.id,
        uri: r.uri,
        label: r.label,
      })),
    };

    return {
      content: [{ type: 'text', text: formatSearchResults(params.query, results) }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleMeSHDescriptor(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MeSHDescriptorParamsSchema.parse(args);
    const client = getMeSHClient();
    const descriptor = await client.getDescriptor(params.mesh_id, params.language);

    if (!descriptor) {
      return {
        content: [{
          type: 'text',
          text: `MeSH Descriptor "${params.mesh_id}" not found. Please verify the ID is correct (e.g., D015242).`,
        }],
        isError: true,
      };
    }

    const structured: MeSHDescriptorOutput = {
      id: descriptor.id,
      uri: descriptor.uri,
      label: descriptor.label,
      scope_note: descriptor.scopeNote,
      tree_numbers: descriptor.treeNumbers.map((tn) => ({
        tree_number: tn.treeNumber,
        uri: tn.uri,
      })),
      concepts: descriptor.concepts.map((c) => ({
        uri: c.uri,
        label: c.label,
        is_preferred: c.isPreferred,
        terms: c.terms,
      })),
      qualifiers: descriptor.qualifiers.map((q) => ({
        id: q.id,
        uri: q.uri,
        label: q.label,
      })),
    };

    return {
      content: [{ type: 'text', text: formatDescriptor(descriptor) }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleMeSHTree(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MeSHByIdParamsSchema.parse(args);
    const client = getMeSHClient();
    const treeNumbers = await client.getTreeNumbers(params.mesh_id);

    const structured: MeSHTreeOutput = {
      mesh_id: params.mesh_id,
      tree_numbers: treeNumbers.map((tn) => ({
        tree_number: tn.treeNumber,
        uri: tn.uri,
      })),
    };

    return {
      content: [{ type: 'text', text: formatTreeNumbers(params.mesh_id, treeNumbers) }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleMeSHQualifiers(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MeSHByIdParamsSchema.parse(args);
    const client = getMeSHClient();
    const qualifiers = await client.getAllowedQualifiers(params.mesh_id);

    const structured: MeSHQualifiersOutput = {
      mesh_id: params.mesh_id,
      qualifiers: qualifiers.map((q) => ({
        id: q.id,
        uri: q.uri,
        label: q.label,
      })),
    };

    return {
      content: [{ type: 'text', text: formatQualifiers(params.mesh_id, qualifiers) }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

toolRegistry.register(meshSearchTool, handleMeSHSearch);
toolRegistry.register(meshDescriptorTool, handleMeSHDescriptor);
toolRegistry.register(meshTreeTool, handleMeSHTree);
toolRegistry.register(meshQualifiersTool, handleMeSHQualifiers);
