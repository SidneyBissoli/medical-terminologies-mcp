/**
 * RxNorm Tools for Medical Terminologies MCP Server
 *
 * - rxnorm_search: Search for drugs by name
 * - rxnorm_concept: Get concept details by RxCUI
 * - rxnorm_ingredients: Get active ingredients for a drug
 * - rxnorm_classes: Get therapeutic classes for a drug
 * - rxnorm_ndc: Get NDC codes for a drug
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/server';
import { toolRegistry } from '../server-core.js';
import {
  getRxNormClient,
  RxNormDrug,
  RxNormConcept,
  RxNormIngredient,
  RxNormDrugClass,
  RxNormNDC,
  RxNormRelatedGroup,
} from '../clients/rxnorm-client.js';
import {
  RxNormSearchParamsSchema,
  RxNormConceptParamsSchema,
  RxNormByRxcuiParamsSchema,
  RxNormNDCParamsSchema,
  RxNormSearchOutputSchema,
  RxNormConceptOutputSchema,
  RxNormIngredientsOutputSchema,
  RxNormClassesOutputSchema,
  RxNormNDCOutputSchema,
  RxNormSearchOutput,
  RxNormConceptOutput,
  RxNormIngredientsOutput,
  RxNormClassesOutput,
  RxNormNDCOutput,
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

const rxnormSearchTool: Tool = {
  name: 'rxnorm_search',
  title: 'Search RxNorm Drugs',
  description: `Search for drugs in RxNorm (Normalized names for clinical drugs).

Use this tool to:
- Find drug concepts by brand or generic name
- Look up medications for prescribing
- Search for drug formulations

Returns matching drugs with RxCUI identifiers, names, and term types.`,
  inputSchema: buildInputSchema(RxNormSearchParamsSchema),
  outputSchema: buildOutputSchema(RxNormSearchOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const rxnormConceptTool: Tool = {
  name: 'rxnorm_concept',
  title: 'RxNorm Concept Details',
  description: `Get detailed information about a specific RxNorm concept by RxCUI.

Use this tool to:
- Get the full name and synonyms for a drug
- Check the concept status (active, remapped, etc.)
- View related concepts (ingredients, brands, forms)

Provide an RxCUI (RxNorm Concept Unique Identifier) like "161".`,
  inputSchema: buildInputSchema(RxNormConceptParamsSchema),
  outputSchema: buildOutputSchema(RxNormConceptOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const rxnormIngredientsTool: Tool = {
  name: 'rxnorm_ingredients',
  title: 'RxNorm Drug Ingredients',
  description: `Get active ingredients for a drug by RxCUI.

Use this tool to:
- Find the active ingredients in a medication
- Check for single vs. multiple ingredient products
- Identify the generic components of brand drugs

Returns ingredient RxCUIs and names.`,
  inputSchema: buildInputSchema(RxNormByRxcuiParamsSchema),
  outputSchema: buildOutputSchema(RxNormIngredientsOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const rxnormClassesTool: Tool = {
  name: 'rxnorm_classes',
  title: 'RxNorm Drug Classes',
  description: `Get therapeutic and pharmacologic classes for a drug.

Use this tool to:
- Find the drug class (e.g., "Beta-blockers", "NSAIDs")
- Identify therapeutic categories
- Look up mechanism of action classifications

Returns class IDs, names, and classification sources.`,
  inputSchema: buildInputSchema(RxNormByRxcuiParamsSchema),
  outputSchema: buildOutputSchema(RxNormClassesOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const rxnormNDCTool: Tool = {
  name: 'rxnorm_ndc',
  title: 'RxNorm / NDC Mapping',
  description: `Map between RxNorm concepts and National Drug Codes (NDC).

Use this tool to:
- Get all NDC codes for a drug (by RxCUI)
- Find the RxCUI for an NDC code
- Cross-reference between coding systems

Provide either an RxCUI to get NDCs, or an NDC to get the RxCUI.`,
  inputSchema: buildInputSchema(RxNormNDCParamsSchema),
  outputSchema: buildOutputSchema(RxNormNDCOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

// ============================================================================
// Formatters
// ============================================================================

function formatDrug(drug: RxNormDrug, index?: number): string {
  const prefix = index !== undefined ? `${index + 1}. ` : '';
  return `${prefix}**${drug.rxcui}** - ${drug.name}\n   Type: ${drug.tty} | Synonym: ${drug.synonym || 'N/A'}`;
}

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

function formatNDCs(rxcui: string, ndcs: RxNormNDC[]): string {
  const lines: string[] = [];

  lines.push(`# NDC Codes for RxCUI ${rxcui}`);
  lines.push('');

  if (ndcs.length === 0) {
    lines.push('No NDC codes found for this concept.');
  } else {
    lines.push(`Found ${ndcs.length} NDC code(s):`);
    lines.push('');

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

async function handleRxNormSearch(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = RxNormSearchParamsSchema.parse(args);
    const client = getRxNormClient();

    let result = await client.searchDrugs(params.query);

    if (result.drugs.length === 0) {
      const approxMatches = await client.getApproximateMatch(params.query, params.max_results);
      if (approxMatches.length > 0) {
        result = {
          drugs: approxMatches.map((m) => ({
            rxcui: m.rxcui,
            name: m.name,
            synonym: '',
            tty: 'APPROX',
            language: 'ENG',
          })),
        };
      }
    }

    const drugsCapped = result.drugs.slice(0, params.max_results);

    const structured: RxNormSearchOutput = {
      query: params.query,
      total_count: result.drugs.length,
      drugs: drugsCapped.map((d) => ({
        rxcui: d.rxcui,
        name: d.name,
        synonym: d.synonym,
        tty: d.tty,
        language: d.language,
      })),
    };

    if (result.drugs.length === 0) {
      return {
        content: [{ type: 'text', text: `No drugs found for "${params.query}".` }],
        structuredContent: structured,
      };
    }

    const formatted = drugsCapped
      .map((drug, index) => formatDrug(drug, index))
      .join('\n\n');

    const header = `## RxNorm Search Results for "${params.query}"\n\nFound ${result.drugs.length} result(s):\n\n`;

    return {
      content: [{ type: 'text', text: header + formatted }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleRxNormConcept(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = RxNormConceptParamsSchema.parse(args);
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
    if (params.include_related) {
      related = await client.getRelatedConcepts(params.rxcui);
    }

    const structured: RxNormConceptOutput = {
      rxcui: concept.rxcui,
      name: concept.name,
      synonym: concept.synonym,
      tty: concept.tty,
      language: concept.language,
      suppress: concept.suppress,
      umlscui: concept.umlscui,
      status: concept.status,
      remapped_to: concept.remappedTo,
      related_groups: related
        ? related.map((g) => ({
            tty: g.tty,
            concepts: g.concepts.map((c) => ({
              rxcui: c.rxcui,
              name: c.name,
              synonym: c.synonym,
              tty: c.tty,
              language: c.language,
            })),
          }))
        : null,
    };

    return {
      content: [{ type: 'text', text: formatConcept(concept, related) }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleRxNormIngredients(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = RxNormByRxcuiParamsSchema.parse(args);
    const client = getRxNormClient();
    const ingredients = await client.getIngredients(params.rxcui);

    const structured: RxNormIngredientsOutput = {
      rxcui: params.rxcui,
      ingredients: ingredients.map((ing) => ({
        rxcui: ing.rxcui,
        name: ing.name,
        tty: ing.tty,
        is_multiple: ing.isMultiple,
      })),
    };

    return {
      content: [{ type: 'text', text: formatIngredients(params.rxcui, ingredients) }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleRxNormClasses(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = RxNormByRxcuiParamsSchema.parse(args);
    const client = getRxNormClient();
    const classes = await client.getDrugClasses(params.rxcui);

    const structured: RxNormClassesOutput = {
      rxcui: params.rxcui,
      classes: classes.map((c) => ({
        class_id: c.classId,
        class_name: c.className,
        class_type: c.classType,
        source: c.source,
      })),
    };

    return {
      content: [{ type: 'text', text: formatClasses(params.rxcui, classes) }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleRxNormNDC(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = RxNormNDCParamsSchema.parse(args);
    const client = getRxNormClient();

    if (params.ndc) {
      const rxcui = await client.getRxcuiByNDC(params.ndc);
      const structured: RxNormNDCOutput = {
        query_mode: 'rxcui_for_ndc',
        rxcui: rxcui ?? null,
        ndc: params.ndc,
        ndcs: [],
      };
      if (!rxcui) {
        return {
          content: [{ type: 'text', text: `No RxCUI found for NDC "${params.ndc}".` }],
          structuredContent: structured,
        };
      }
      return {
        content: [{
          type: 'text',
          text: `# NDC Lookup\n\nNDC: ${params.ndc}\nRxCUI: **${rxcui}**`,
        }],
        structuredContent: structured,
      };
    }

    // Schema's refine guarantees at least one of rxcui/ndc; ndc was empty so
    // rxcui must be set here.
    const rxcui = params.rxcui as string;
    const ndcs = await client.getNDCs(rxcui);

    const structured: RxNormNDCOutput = {
      query_mode: 'ndcs_for_rxcui',
      rxcui,
      ndc: null,
      ndcs: ndcs.map((n) => ({ ndc: n.ndc })),
    };

    return {
      content: [{ type: 'text', text: formatNDCs(rxcui, ndcs) }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

toolRegistry.register(rxnormSearchTool, handleRxNormSearch);
toolRegistry.register(rxnormConceptTool, handleRxNormConcept);
toolRegistry.register(rxnormIngredientsTool, handleRxNormIngredients);
toolRegistry.register(rxnormClassesTool, handleRxNormClasses);
toolRegistry.register(rxnormNDCTool, handleRxNormNDC);
