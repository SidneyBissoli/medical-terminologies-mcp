/**
 * SNOMED CT Tools for Medical Terminologies MCP Server
 *
 * Provides access to SNOMED CT through:
 * - snomed_search: Search concepts by term
 * - snomed_concept: Get concept details by SCTID
 * - snomed_hierarchy: Get parent/child relationships
 * - snomed_descriptions: Get all descriptions (FSN, PT, synonyms)
 * - snomed_ecl: Execute ECL queries
 *
 * ⚠️ DISCLAIMER: SNOMED CT content is for reference purposes only.
 * Production use requires an IHTSDO (SNOMED International) license.
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toolRegistry } from '../server.js';
import {
  getSNOMEDClient,
  SNOMED_DISCLAIMER,
  SNOMEDSearchResult,
  SNOMEDConcept,
  SNOMEDHierarchyConcept,
  SNOMEDDescription,
} from '../clients/snomed-client.js';
import { ApiError } from '../types/index.js';

// ============================================================================
// Zod Schemas
// ============================================================================

const SNOMEDSearchParamsSchema = z.object({
  query: z.string().min(1).describe('Search term'),
  activeOnly: z.boolean().optional().default(true).describe('Only active concepts'),
  maxResults: z.number().int().min(1).max(100).optional().default(25).describe('Maximum results'),
});

const SNOMEDConceptParamsSchema = z.object({
  sctid: z.string().min(1).describe('SNOMED CT Identifier'),
});

const SNOMEDHierarchyParamsSchema = z.object({
  sctid: z.string().min(1).describe('SNOMED CT Identifier'),
  direction: z.enum(['parents', 'children', 'both']).optional().default('both').describe('Direction'),
  limit: z.number().int().min(1).max(100).optional().default(50).describe('Max children'),
});

const SNOMEDDescriptionsParamsSchema = z.object({
  sctid: z.string().min(1).describe('SNOMED CT Identifier'),
});

const SNOMEDECLParamsSchema = z.object({
  ecl: z.string().min(1).describe('ECL expression'),
  maxResults: z.number().int().min(1).max(100).optional().default(25).describe('Maximum results'),
});

// ============================================================================
// Tool Definitions
// ============================================================================

const SNOMED_TOOL_DISCLAIMER = `\n\n---\n${SNOMED_DISCLAIMER}`;

/**
 * snomed_search tool definition
 */
const snomedSearchTool: Tool = {
  name: 'snomed_search',
  description: `Search for SNOMED CT concepts by term.

Use this tool to:
- Find clinical concepts (diseases, procedures, findings)
- Look up terms for clinical documentation
- Search for specific medical concepts

Returns matching concepts with SCTID, Fully Specified Name (FSN), and Preferred Term (PT).

⚠️ SNOMED CT content is for reference only. Production use requires IHTSDO license.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search term (e.g., "diabetes", "myocardial infarction")',
      },
      active_only: {
        type: 'boolean',
        description: 'Only return active concepts. Default: true',
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
 * snomed_concept tool definition
 */
const snomedConceptTool: Tool = {
  name: 'snomed_concept',
  description: `Get detailed information about a SNOMED CT concept by SCTID.

Use this tool to:
- Get the Fully Specified Name and Preferred Term
- Check if a concept is active
- View the definition status (primitive vs. fully defined)

Provide a SCTID like "73211009" (Diabetes mellitus).

⚠️ SNOMED CT content is for reference only. Production use requires IHTSDO license.`,
  inputSchema: {
    type: 'object',
    properties: {
      sctid: {
        type: 'string',
        description: 'SNOMED CT Identifier (e.g., 73211009)',
      },
    },
    required: ['sctid'],
  },
};

/**
 * snomed_hierarchy tool definition
 */
const snomedHierarchyTool: Tool = {
  name: 'snomed_hierarchy',
  description: `Get the hierarchical relationships (IS-A) for a SNOMED CT concept.

Use this tool to:
- Find parent concepts (supertypes)
- Find child concepts (subtypes)
- Navigate the SNOMED CT hierarchy

Returns parent and/or child concepts based on IS-A relationships.

⚠️ SNOMED CT content is for reference only. Production use requires IHTSDO license.`,
  inputSchema: {
    type: 'object',
    properties: {
      sctid: {
        type: 'string',
        description: 'SNOMED CT Identifier',
      },
      direction: {
        type: 'string',
        enum: ['parents', 'children', 'both'],
        description: 'Direction: parents, children, or both. Default: both',
      },
      limit: {
        type: 'number',
        description: 'Maximum children to return (1-100). Default: 50',
        minimum: 1,
        maximum: 100,
      },
    },
    required: ['sctid'],
  },
};

/**
 * snomed_descriptions tool definition
 */
const snomedDescriptionsTool: Tool = {
  name: 'snomed_descriptions',
  description: `Get all descriptions (names) for a SNOMED CT concept.

Use this tool to:
- Get the Fully Specified Name (FSN)
- Get the Preferred Term (PT)
- View all synonyms for a concept

Returns all active descriptions with their type and acceptability.

⚠️ SNOMED CT content is for reference only. Production use requires IHTSDO license.`,
  inputSchema: {
    type: 'object',
    properties: {
      sctid: {
        type: 'string',
        description: 'SNOMED CT Identifier',
      },
    },
    required: ['sctid'],
  },
};

/**
 * snomed_ecl tool definition
 */
const snomedECLTool: Tool = {
  name: 'snomed_ecl',
  description: `Execute an ECL (Expression Constraint Language) query.

Use this tool to:
- Find all descendants of a concept: "<< 73211009"
- Find direct children: "< 73211009"
- Find by attribute: "< 404684003 : 363698007 = 39057004"
- Combine constraints: "<< 73211009 AND << 64572001"

ECL is a powerful query language for navigating SNOMED CT.

⚠️ SNOMED CT content is for reference only. Production use requires IHTSDO license.`,
  inputSchema: {
    type: 'object',
    properties: {
      ecl: {
        type: 'string',
        description: 'ECL expression (e.g., "<< 73211009" for all types of diabetes)',
      },
      max_results: {
        type: 'number',
        description: 'Maximum results (1-100). Default: 25',
        minimum: 1,
        maximum: 100,
      },
    },
    required: ['ecl'],
  },
};

// ============================================================================
// Formatters
// ============================================================================

/**
 * Formats search results for display
 */
function formatSearchResults(query: string, results: SNOMEDSearchResult[]): string {
  const lines: string[] = [];

  lines.push(`## SNOMED CT Search Results for "${query}"`);
  lines.push('');

  if (results.length === 0) {
    lines.push('No concepts found.');
    lines.push(SNOMED_TOOL_DISCLAIMER);
    return lines.join('\n');
  }

  lines.push(`Found ${results.length} concept(s):`);
  lines.push('');
  lines.push('| SCTID | Preferred Term | FSN |');
  lines.push('|-------|----------------|-----|');

  for (const result of results) {
    const status = result.active ? '' : ' ⚠️';
    lines.push(`| ${result.conceptId}${status} | ${result.pt} | ${result.fsn} |`);
  }

  lines.push(SNOMED_TOOL_DISCLAIMER);
  return lines.join('\n');
}

/**
 * Formats concept details for display
 */
function formatConcept(concept: SNOMEDConcept): string {
  const lines: string[] = [];

  lines.push(`# ${concept.pt}`);
  lines.push(`SCTID: ${concept.conceptId}`);
  lines.push('');

  lines.push('## Properties');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|----------|-------|');
  lines.push(`| Fully Specified Name | ${concept.fsn} |`);
  lines.push(`| Preferred Term | ${concept.pt} |`);
  lines.push(`| Active | ${concept.active ? 'Yes' : 'No'} |`);
  lines.push(`| Definition Status | ${concept.definitionStatus} |`);
  lines.push(`| Effective Time | ${concept.effectiveTime} |`);
  lines.push(`| Module ID | ${concept.moduleId} |`);

  lines.push(SNOMED_TOOL_DISCLAIMER);
  return lines.join('\n');
}

/**
 * Formats hierarchy for display
 */
function formatHierarchy(
  sctid: string,
  parents: SNOMEDHierarchyConcept[],
  children: SNOMEDHierarchyConcept[],
  direction: string
): string {
  const lines: string[] = [];

  lines.push(`# Hierarchy for SCTID ${sctid}`);
  lines.push('');

  if (direction === 'parents' || direction === 'both') {
    lines.push('## Parents (Supertypes)');
    lines.push('');
    if (parents.length === 0) {
      lines.push('No parents found (may be a top-level concept).');
    } else {
      lines.push('| SCTID | Preferred Term |');
      lines.push('|-------|----------------|');
      for (const parent of parents) {
        const pt = typeof parent.pt === 'string' ? parent.pt : parent.pt?.term || '';
        lines.push(`| ${parent.conceptId} | ${pt} |`);
      }
    }
    lines.push('');
  }

  if (direction === 'children' || direction === 'both') {
    lines.push('## Children (Subtypes)');
    lines.push('');
    if (children.length === 0) {
      lines.push('No children found (may be a leaf concept).');
    } else {
      lines.push('| SCTID | Preferred Term |');
      lines.push('|-------|----------------|');
      for (const child of children) {
        const pt = typeof child.pt === 'string' ? child.pt : child.pt?.term || '';
        lines.push(`| ${child.conceptId} | ${pt} |`);
      }
    }
    lines.push('');
  }

  lines.push(SNOMED_TOOL_DISCLAIMER);
  return lines.join('\n');
}

/**
 * Formats descriptions for display
 */
function formatDescriptions(sctid: string, descriptions: SNOMEDDescription[]): string {
  const lines: string[] = [];

  lines.push(`# Descriptions for SCTID ${sctid}`);
  lines.push('');

  if (descriptions.length === 0) {
    lines.push('No descriptions found.');
    lines.push(SNOMED_TOOL_DISCLAIMER);
    return lines.join('\n');
  }

  // Group by type
  const fsn = descriptions.filter(d => d.type === 'FSN');

  if (fsn.length > 0) {
    lines.push('## Fully Specified Name (FSN)');
    lines.push('');
    for (const desc of fsn) {
      lines.push(`- ${desc.term}`);
    }
    lines.push('');
  }

  lines.push('## All Descriptions');
  lines.push('');
  lines.push('| Type | Term | Active | Language |');
  lines.push('|------|------|--------|----------|');

  for (const desc of descriptions) {
    const active = desc.active ? '✅' : '❌';
    lines.push(`| ${desc.type} | ${desc.term} | ${active} | ${desc.lang} |`);
  }

  lines.push(SNOMED_TOOL_DISCLAIMER);
  return lines.join('\n');
}

/**
 * Formats ECL results for display
 */
function formatECLResults(ecl: string, results: SNOMEDSearchResult[]): string {
  const lines: string[] = [];

  lines.push(`## ECL Query Results`);
  lines.push('');
  lines.push(`**Query:** \`${ecl}\``);
  lines.push('');

  if (results.length === 0) {
    lines.push('No concepts matched the ECL query.');
    lines.push(SNOMED_TOOL_DISCLAIMER);
    return lines.join('\n');
  }

  lines.push(`Found ${results.length} concept(s):`);
  lines.push('');
  lines.push('| SCTID | Preferred Term |');
  lines.push('|-------|----------------|');

  for (const result of results) {
    lines.push(`| ${result.conceptId} | ${result.pt} |`);
  }

  lines.push(SNOMED_TOOL_DISCLAIMER);
  return lines.join('\n');
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Handler for snomed_search
 */
async function handleSNOMEDSearch(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = SNOMEDSearchParamsSchema.parse({
      query: args.query,
      activeOnly: args.active_only ?? true,
      maxResults: args.max_results ?? 25,
    });

    const client = getSNOMEDClient();
    const results = await client.searchConcepts(params.query, params.activeOnly, params.maxResults);

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
 * Handler for snomed_concept
 */
async function handleSNOMEDConcept(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = SNOMEDConceptParamsSchema.parse({
      sctid: args.sctid,
    });

    const client = getSNOMEDClient();
    const concept = await client.getConcept(params.sctid);

    if (!concept) {
      return {
        content: [{
          type: 'text',
          text: `SCTID "${params.sctid}" not found. Please verify the identifier is correct.${SNOMED_TOOL_DISCLAIMER}`,
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text',
        text: formatConcept(concept),
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
 * Handler for snomed_hierarchy
 */
async function handleSNOMEDHierarchy(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = SNOMEDHierarchyParamsSchema.parse({
      sctid: args.sctid,
      direction: args.direction ?? 'both',
      limit: args.limit ?? 50,
    });

    const client = getSNOMEDClient();

    let parents: SNOMEDHierarchyConcept[] = [];
    let children: SNOMEDHierarchyConcept[] = [];

    if (params.direction === 'parents' || params.direction === 'both') {
      parents = await client.getParents(params.sctid);
    }

    if (params.direction === 'children' || params.direction === 'both') {
      children = await client.getChildren(params.sctid, params.limit);
    }

    return {
      content: [{
        type: 'text',
        text: formatHierarchy(params.sctid, parents, children, params.direction),
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
 * Handler for snomed_descriptions
 */
async function handleSNOMEDDescriptions(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = SNOMEDDescriptionsParamsSchema.parse({
      sctid: args.sctid,
    });

    const client = getSNOMEDClient();
    const descriptions = await client.getDescriptions(params.sctid);

    return {
      content: [{
        type: 'text',
        text: formatDescriptions(params.sctid, descriptions),
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
 * Handler for snomed_ecl
 */
async function handleSNOMEDECL(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = SNOMEDECLParamsSchema.parse({
      ecl: args.ecl,
      maxResults: args.max_results ?? 25,
    });

    const client = getSNOMEDClient();
    const results = await client.executeECL(params.ecl, params.maxResults);

    return {
      content: [{
        type: 'text',
        text: formatECLResults(params.ecl, results),
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
          text: `API error (${error.code}): ${error.message}\n\nECL syntax help:\n- Descendants: << conceptId\n- Children: < conceptId\n- Self: conceptId\n- AND/OR: expr1 AND expr2`,
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

// Register all SNOMED CT tools immediately when this module is imported
toolRegistry.register(snomedSearchTool, handleSNOMEDSearch);
toolRegistry.register(snomedConceptTool, handleSNOMEDConcept);
toolRegistry.register(snomedHierarchyTool, handleSNOMEDHierarchy);
toolRegistry.register(snomedDescriptionsTool, handleSNOMEDDescriptions);
toolRegistry.register(snomedECLTool, handleSNOMEDECL);
