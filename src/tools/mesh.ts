/**
 * MeSH Tools for Medical Terminologies MCP Server
 *
 * Provides access to MeSH (Medical Subject Headings) through:
 * - mesh_search: Search descriptors by term
 * - mesh_descriptor: Get descriptor details by ID
 * - mesh_tree: Get tree hierarchy for a descriptor
 * - mesh_qualifiers: Get allowed qualifiers for a descriptor
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toolRegistry } from '../server.js';
import {
  getMeSHClient,
  MeSHSearchResult,
  MeSHDescriptor,
  MeSHTreeNumber,
  MeSHQualifier,
} from '../clients/mesh-client.js';
import { ApiError } from '../types/index.js';

// ============================================================================
// Zod Schemas
// ============================================================================

const MeSHSearchParamsSchema = z.object({
  query: z.string().min(1).describe('Search term'),
  match: z.enum(['exact', 'contains', 'startswith']).optional().default('contains').describe('Match type'),
  maxResults: z.number().int().min(1).max(100).optional().default(25).describe('Maximum results'),
});

const MeSHDescriptorParamsSchema = z.object({
  meshId: z.string().min(1).describe('MeSH Descriptor ID (e.g., D015242)'),
});

const MeSHTreeParamsSchema = z.object({
  meshId: z.string().min(1).describe('MeSH Descriptor ID'),
});

const MeSHQualifiersParamsSchema = z.object({
  meshId: z.string().min(1).describe('MeSH Descriptor ID'),
});

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * mesh_search tool definition
 */
const meshSearchTool: Tool = {
  name: 'mesh_search',
  description: `Search for MeSH (Medical Subject Headings) descriptors.

Use this tool to:
- Find MeSH terms for indexing medical literature
- Look up subject headings for PubMed searches
- Find controlled vocabulary terms

Returns matching descriptors with MeSH IDs and labels.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search term (e.g., "diabetes", "heart failure")',
      },
      match: {
        type: 'string',
        enum: ['exact', 'contains', 'startswith'],
        description: 'Match type: exact, contains, or startswith. Default: contains',
      },
      max_results: {
        type: 'number',
        description: 'Maximum results (1-100). Default: 25',
        minimum: 1,
        maximum: 100,
      },
    },
    required: ['query'],
  },
};

/**
 * mesh_descriptor tool definition
 */
const meshDescriptorTool: Tool = {
  name: 'mesh_descriptor',
  description: `Get detailed information about a MeSH descriptor by ID.

Use this tool to:
- Get the full definition (scope note) of a MeSH term
- View tree numbers showing hierarchy location
- See related concepts and synonyms

Provide a MeSH Descriptor ID like "D015242" (Ofloxacin).`,
  inputSchema: {
    type: 'object',
    properties: {
      mesh_id: {
        type: 'string',
        description: 'MeSH Descriptor ID (e.g., D015242, D003920)',
      },
    },
    required: ['mesh_id'],
  },
};

/**
 * mesh_tree tool definition
 */
const meshTreeTool: Tool = {
  name: 'mesh_tree',
  description: `Get the tree hierarchy location(s) for a MeSH descriptor.

Use this tool to:
- See where a term fits in the MeSH hierarchy
- Understand broader/narrower relationships
- Find related terms in the same branch

MeSH tree numbers show the hierarchical path (e.g., C14.280.647 for Myocardial Infarction).`,
  inputSchema: {
    type: 'object',
    properties: {
      mesh_id: {
        type: 'string',
        description: 'MeSH Descriptor ID',
      },
    },
    required: ['mesh_id'],
  },
};

/**
 * mesh_qualifiers tool definition
 */
const meshQualifiersTool: Tool = {
  name: 'mesh_qualifiers',
  description: `Get allowed qualifiers (subheadings) for a MeSH descriptor.

Use this tool to:
- Find which qualifiers can be combined with a descriptor
- Build precise MeSH search queries
- Understand aspects that can be specified

Qualifiers refine descriptors (e.g., "Diabetes Mellitus/drug therapy").`,
  inputSchema: {
    type: 'object',
    properties: {
      mesh_id: {
        type: 'string',
        description: 'MeSH Descriptor ID',
      },
    },
    required: ['mesh_id'],
  },
};

// ============================================================================
// Formatters
// ============================================================================

/**
 * Formats search results for display
 */
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

/**
 * Formats descriptor details for display
 */
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

/**
 * Formats tree numbers for display
 */
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

  // Group by top-level category
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

/**
 * Gets MeSH category name from tree number prefix
 */
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

/**
 * Formats qualifiers for display
 */
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
    const label = qual.label || '(lookup required)';
    lines.push(`| ${qual.id} | ${label} |`);
  }

  lines.push('');
  lines.push('*Use qualifiers with descriptors like: "Diabetes Mellitus/therapy"*');

  return lines.join('\n');
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Handler for mesh_search
 */
async function handleMeSHSearch(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MeSHSearchParamsSchema.parse({
      query: args.query,
      match: args.match ?? 'contains',
      maxResults: args.max_results ?? 25,
    });

    const client = getMeSHClient();
    const results = await client.searchDescriptors(params.query, params.match, params.maxResults);

    return {
      content: [{
        type: 'text',
        text: formatSearchResults(params.query, results),
      }],
    };
  } catch (error) {
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
 * Handler for mesh_descriptor
 */
async function handleMeSHDescriptor(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MeSHDescriptorParamsSchema.parse({
      meshId: args.mesh_id,
    });

    const client = getMeSHClient();
    const descriptor = await client.getDescriptor(params.meshId);

    if (!descriptor) {
      return {
        content: [{
          type: 'text',
          text: `MeSH Descriptor "${params.meshId}" not found. Please verify the ID is correct (e.g., D015242).`,
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text',
        text: formatDescriptor(descriptor),
      }],
    };
  } catch (error) {
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
 * Handler for mesh_tree
 */
async function handleMeSHTree(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MeSHTreeParamsSchema.parse({
      meshId: args.mesh_id,
    });

    const client = getMeSHClient();
    const treeNumbers = await client.getTreeNumbers(params.meshId);

    return {
      content: [{
        type: 'text',
        text: formatTreeNumbers(params.meshId, treeNumbers),
      }],
    };
  } catch (error) {
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
 * Handler for mesh_qualifiers
 */
async function handleMeSHQualifiers(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MeSHQualifiersParamsSchema.parse({
      meshId: args.mesh_id,
    });

    const client = getMeSHClient();
    const qualifiers = await client.getAllowedQualifiers(params.meshId);

    return {
      content: [{
        type: 'text',
        text: formatQualifiers(params.meshId, qualifiers),
      }],
    };
  } catch (error) {
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

// Register all MeSH tools immediately when this module is imported
toolRegistry.register(meshSearchTool, handleMeSHSearch);
toolRegistry.register(meshDescriptorTool, handleMeSHDescriptor);
toolRegistry.register(meshTreeTool, handleMeSHTree);
toolRegistry.register(meshQualifiersTool, handleMeSHQualifiers);
