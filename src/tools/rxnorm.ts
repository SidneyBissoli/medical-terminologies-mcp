/**
 * RxNorm Tools for Medical Terminologies MCP Server
 *
 * Provides access to RxNorm (Normalized names for clinical drugs)
 * through the following tools:
 * - rxnorm_search: Search for drugs by name
 * - rxnorm_concept: Get concept details by RxCUI
 * - rxnorm_ingredients: Get active ingredients for a drug
 * - rxnorm_classes: Get therapeutic classes for a drug
 * - rxnorm_ndc: Get NDC codes for a drug
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toolRegistry } from '../server.js';
import {
  getRxNormClient,
  RxNormDrug,
  RxNormConcept,
  RxNormIngredient,
  RxNormDrugClass,
  RxNormNDC,
  RxNormRelatedGroup,
} from '../clients/rxnorm-client.js';
import { ApiError } from '../types/index.js';

// ============================================================================
// Zod Schemas
// ============================================================================

const RxNormSearchParamsSchema = z.object({
  query: z.string().min(1).describe('Drug name to search'),
  maxResults: z.number().int().min(1).max(100).optional().default(25).describe('Maximum results'),
});

const RxNormConceptParamsSchema = z.object({
  rxcui: z.string().min(1).describe('RxNorm Concept Unique Identifier'),
  includeRelated: z.boolean().optional().default(false).describe('Include related concepts'),
});

const RxNormIngredientsParamsSchema = z.object({
  rxcui: z.string().min(1).describe('RxCUI of the drug'),
});

const RxNormClassesParamsSchema = z.object({
  rxcui: z.string().min(1).describe('RxCUI of the drug'),
});

const RxNormNDCParamsSchema = z.object({
  rxcui: z.string().optional().describe('RxCUI to get NDC codes for'),
  ndc: z.string().optional().describe('NDC code to look up RxCUI'),
});

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * rxnorm_search tool definition
 */
const rxnormSearchTool: Tool = {
  name: 'rxnorm_search',
  description: `Search for drugs in RxNorm (Normalized names for clinical drugs).

Use this tool to:
- Find drug concepts by brand or generic name
- Look up medications for prescribing
- Search for drug formulations

Returns matching drugs with RxCUI identifiers, names, and term types.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Drug name to search (brand or generic)',
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
 * rxnorm_concept tool definition
 */
const rxnormConceptTool: Tool = {
  name: 'rxnorm_concept',
  description: `Get detailed information about a specific RxNorm concept by RxCUI.

Use this tool to:
- Get the full name and synonyms for a drug
- Check the concept status (active, remapped, etc.)
- View related concepts (ingredients, brands, forms)

Provide an RxCUI (RxNorm Concept Unique Identifier) like "161".`,
  inputSchema: {
    type: 'object',
    properties: {
      rxcui: {
        type: 'string',
        description: 'RxNorm Concept Unique Identifier',
      },
      include_related: {
        type: 'boolean',
        description: 'Include related concepts (ingredients, brands, dose forms)',
      },
    },
    required: ['rxcui'],
  },
};

/**
 * rxnorm_ingredients tool definition
 */
const rxnormIngredientsTool: Tool = {
  name: 'rxnorm_ingredients',
  description: `Get active ingredients for a drug by RxCUI.

Use this tool to:
- Find the active ingredients in a medication
- Check for single vs. multiple ingredient products
- Identify the generic components of brand drugs

Returns ingredient RxCUIs and names.`,
  inputSchema: {
    type: 'object',
    properties: {
      rxcui: {
        type: 'string',
        description: 'RxCUI of the drug product',
      },
    },
    required: ['rxcui'],
  },
};

/**
 * rxnorm_classes tool definition
 */
const rxnormClassesTool: Tool = {
  name: 'rxnorm_classes',
  description: `Get therapeutic and pharmacologic classes for a drug.

Use this tool to:
- Find the drug class (e.g., "Beta-blockers", "NSAIDs")
- Identify therapeutic categories
- Look up mechanism of action classifications

Returns class IDs, names, and classification sources.`,
  inputSchema: {
    type: 'object',
    properties: {
      rxcui: {
        type: 'string',
        description: 'RxCUI of the drug',
      },
    },
    required: ['rxcui'],
  },
};

/**
 * rxnorm_ndc tool definition
 */
const rxnormNDCTool: Tool = {
  name: 'rxnorm_ndc',
  description: `Map between RxNorm concepts and National Drug Codes (NDC).

Use this tool to:
- Get all NDC codes for a drug (by RxCUI)
- Find the RxCUI for an NDC code
- Cross-reference between coding systems

Provide either an RxCUI to get NDCs, or an NDC to get the RxCUI.`,
  inputSchema: {
    type: 'object',
    properties: {
      rxcui: {
        type: 'string',
        description: 'RxCUI to get NDC codes for',
      },
      ndc: {
        type: 'string',
        description: 'NDC code to look up RxCUI (alternative to rxcui)',
      },
    },
  },
};

// ============================================================================
// Formatters
// ============================================================================

/**
 * Formats a drug for display
 */
function formatDrug(drug: RxNormDrug, index?: number): string {
  const prefix = index !== undefined ? `${index + 1}. ` : '';
  return `${prefix}**${drug.rxcui}** - ${drug.name}\n   Type: ${drug.tty} | Synonym: ${drug.synonym || 'N/A'}`;
}

/**
 * Formats concept details for display
 */
function formatConcept(concept: RxNormConcept, related?: RxNormRelatedGroup[]): string {
  const lines: string[] = [];

  lines.push(`# ${concept.name}`);
  lines.push(`RxCUI: ${concept.rxcui}`);
  lines.push('');

  lines.push('## Properties');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|----------|-------|');
  lines.push(`| Term Type | ${concept.tty} |`);
  lines.push(`| Synonym | ${concept.synonym || 'N/A'} |`);
  lines.push(`| Status | ${concept.status} |`);
  lines.push(`| Language | ${concept.language} |`);
  lines.push(`| Suppress | ${concept.suppress} |`);
  if (concept.umlscui) {
    lines.push(`| UMLS CUI | ${concept.umlscui} |`);
  }

  if (concept.remappedTo && concept.remappedTo.length > 0) {
    lines.push('');
    lines.push('## Remapped To');
    lines.push('');
    for (const rxcui of concept.remappedTo) {
      lines.push(`- ${rxcui}`);
    }
  }

  if (related && related.length > 0) {
    lines.push('');
    lines.push('## Related Concepts');
    lines.push('');

    for (const group of related) {
      lines.push(`### ${getTtyDescription(group.tty)} (${group.tty})`);
      lines.push('');
      for (const c of group.concepts) {
        lines.push(`- **${c.rxcui}** - ${c.name}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Gets a human-readable description for term type
 */
function getTtyDescription(tty: string): string {
  const descriptions: Record<string, string> = {
    IN: 'Ingredient',
    MIN: 'Multiple Ingredients',
    PIN: 'Precise Ingredient',
    BN: 'Brand Name',
    SBD: 'Semantic Branded Drug',
    SCD: 'Semantic Clinical Drug',
    SBDC: 'Semantic Branded Drug Component',
    SCDC: 'Semantic Clinical Drug Component',
    SBDF: 'Semantic Branded Drug Form',
    SCDF: 'Semantic Clinical Drug Form',
    SBDG: 'Semantic Branded Dose Form Group',
    SCDG: 'Semantic Clinical Dose Form Group',
    DF: 'Dose Form',
    DFG: 'Dose Form Group',
    GPCK: 'Generic Pack',
    BPCK: 'Brand Pack',
  };
  return descriptions[tty] || tty;
}

/**
 * Formats ingredients for display
 */
function formatIngredients(rxcui: string, ingredients: RxNormIngredient[]): string {
  const lines: string[] = [];

  lines.push(`# Ingredients for RxCUI ${rxcui}`);
  lines.push('');

  if (ingredients.length === 0) {
    lines.push('No ingredients found for this concept.');
    lines.push('');
    lines.push('This may mean:');
    lines.push('- The RxCUI is already an ingredient');
    lines.push('- The concept does not have defined ingredients');
  } else {
    lines.push(`Found ${ingredients.length} ingredient(s):`);
    lines.push('');
    lines.push('| RxCUI | Name | Type |');
    lines.push('|-------|------|------|');

    for (const ing of ingredients) {
      const type = ing.isMultiple ? 'Multiple Ingredient' : 'Single Ingredient';
      lines.push(`| ${ing.rxcui} | ${ing.name} | ${type} |`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats drug classes for display
 */
function formatClasses(rxcui: string, classes: RxNormDrugClass[]): string {
  const lines: string[] = [];

  lines.push(`# Drug Classes for RxCUI ${rxcui}`);
  lines.push('');

  if (classes.length === 0) {
    lines.push('No drug classes found for this concept.');
  } else {
    lines.push(`Found ${classes.length} class(es):`);
    lines.push('');
    lines.push('| Class ID | Class Name | Type | Source |');
    lines.push('|----------|------------|------|--------|');

    for (const cls of classes) {
      lines.push(`| ${cls.classId} | ${cls.className} | ${cls.classType} | ${cls.source || 'N/A'} |`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats NDC codes for display
 */
function formatNDCs(rxcui: string, ndcs: RxNormNDC[]): string {
  const lines: string[] = [];

  lines.push(`# NDC Codes for RxCUI ${rxcui}`);
  lines.push('');

  if (ndcs.length === 0) {
    lines.push('No NDC codes found for this concept.');
  } else {
    lines.push(`Found ${ndcs.length} NDC code(s):`);
    lines.push('');

    // Show in columns for readability
    const columns = 3;
    const rows = Math.ceil(ndcs.length / columns);

    for (let i = 0; i < rows; i++) {
      const row: string[] = [];
      for (let j = 0; j < columns; j++) {
        const idx = i + j * rows;
        if (idx < ndcs.length) {
          row.push(ndcs[idx].ndc);
        }
      }
      lines.push(row.join(' | '));
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Handler for rxnorm_search
 */
async function handleRxNormSearch(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = RxNormSearchParamsSchema.parse({
      query: args.query,
      maxResults: args.max_results ?? 25,
    });

    const client = getRxNormClient();

    // Try exact drug search first, then approximate if no results
    let result = await client.searchDrugs(params.query);

    if (result.drugs.length === 0) {
      const approxMatches = await client.getApproximateMatch(params.query, params.maxResults);
      if (approxMatches.length > 0) {
        // Convert approximate matches to drug format
        result = {
          drugs: approxMatches.map(m => ({
            rxcui: m.rxcui,
            name: m.name,
            synonym: '',
            tty: 'APPROX',
            language: 'ENG',
          })),
        };
      }
    }

    if (result.drugs.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No drugs found for "${params.query}".`,
        }],
      };
    }

    const formatted = result.drugs
      .slice(0, params.maxResults)
      .map((drug, index) => formatDrug(drug, index))
      .join('\n\n');

    const header = `## RxNorm Search Results for "${params.query}"\n\nFound ${result.drugs.length} result(s):\n\n`;

    return {
      content: [{
        type: 'text',
        text: header + formatted,
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
 * Handler for rxnorm_concept
 */
async function handleRxNormConcept(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = RxNormConceptParamsSchema.parse({
      rxcui: args.rxcui,
      includeRelated: args.include_related ?? false,
    });

    const client = getRxNormClient();
    const concept = await client.getConcept(params.rxcui);

    if (!concept) {
      return {
        content: [{
          type: 'text',
          text: `RxCUI "${params.rxcui}" not found. Please verify the identifier is correct.`,
        }],
        isError: true,
      };
    }

    let related: RxNormRelatedGroup[] | undefined;
    if (params.includeRelated) {
      related = await client.getRelatedConcepts(params.rxcui);
    }

    return {
      content: [{
        type: 'text',
        text: formatConcept(concept, related),
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
 * Handler for rxnorm_ingredients
 */
async function handleRxNormIngredients(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = RxNormIngredientsParamsSchema.parse({
      rxcui: args.rxcui,
    });

    const client = getRxNormClient();
    const ingredients = await client.getIngredients(params.rxcui);

    return {
      content: [{
        type: 'text',
        text: formatIngredients(params.rxcui, ingredients),
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
 * Handler for rxnorm_classes
 */
async function handleRxNormClasses(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = RxNormClassesParamsSchema.parse({
      rxcui: args.rxcui,
    });

    const client = getRxNormClient();
    const classes = await client.getDrugClasses(params.rxcui);

    return {
      content: [{
        type: 'text',
        text: formatClasses(params.rxcui, classes),
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
 * Handler for rxnorm_ndc
 */
async function handleRxNormNDC(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = RxNormNDCParamsSchema.parse({
      rxcui: args.rxcui,
      ndc: args.ndc,
    });

    if (!params.rxcui && !params.ndc) {
      return {
        content: [{
          type: 'text',
          text: 'Please provide either an rxcui or an ndc parameter.',
        }],
        isError: true,
      };
    }

    const client = getRxNormClient();

    if (params.ndc) {
      // Look up RxCUI by NDC
      const rxcui = await client.getRxcuiByNDC(params.ndc);

      if (!rxcui) {
        return {
          content: [{
            type: 'text',
            text: `No RxCUI found for NDC "${params.ndc}".`,
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: `# NDC Lookup\n\nNDC: ${params.ndc}\nRxCUI: **${rxcui}**`,
        }],
      };
    }

    // Get NDCs for RxCUI
    const ndcs = await client.getNDCs(params.rxcui!);

    return {
      content: [{
        type: 'text',
        text: formatNDCs(params.rxcui!, ndcs),
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

// Register all RxNorm tools immediately when this module is imported
toolRegistry.register(rxnormSearchTool, handleRxNormSearch);
toolRegistry.register(rxnormConceptTool, handleRxNormConcept);
toolRegistry.register(rxnormIngredientsTool, handleRxNormIngredients);
toolRegistry.register(rxnormClassesTool, handleRxNormClasses);
toolRegistry.register(rxnormNDCTool, handleRxNormNDC);
