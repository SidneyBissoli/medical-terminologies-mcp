/**
 * Crosswalk Tools for Medical Terminologies MCP Server
 *
 * Provides cross-terminology mapping tools:
 * - map_icd10_to_icd11: Map ICD-10 codes to ICD-11
 * - map_snomed_to_icd10: Map SNOMED CT to ICD-10
 * - map_loinc_to_snomed: Map LOINC to SNOMED CT
 * - find_equivalent: Search for equivalent terms across terminologies
 *
 * Note: Some mappings may not be freely available.
 * Tools return explanatory messages when mappings are unavailable.
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toolRegistry } from '../server.js';
import { getWHOClient } from '../clients/who-client.js';
import { getSNOMEDClient, SNOMED_DISCLAIMER } from '../clients/snomed-client.js';
import { getNLMClient } from '../clients/nlm-client.js';
import { getRxNormClient } from '../clients/rxnorm-client.js';
import { getMeSHClient } from '../clients/mesh-client.js';
import { ApiError } from '../types/index.js';

// ============================================================================
// Zod Schemas
// ============================================================================

const ICD10ToICD11ParamsSchema = z.object({
  icd10Code: z.string().min(1).describe('ICD-10 code to map'),
});

const SNOMEDToICD10ParamsSchema = z.object({
  sctid: z.string().min(1).describe('SNOMED CT ID to map'),
});

const LOINCToSNOMEDParamsSchema = z.object({
  loincCode: z.string().min(1).describe('LOINC code to map'),
});

const FindEquivalentParamsSchema = z.object({
  term: z.string().min(1).describe('Term to search'),
  sourceTerminology: z.enum(['icd11', 'snomed', 'loinc', 'rxnorm', 'mesh']).optional().describe('Source terminology'),
  targetTerminologies: z.array(z.enum(['icd11', 'snomed', 'loinc', 'rxnorm', 'mesh'])).optional().describe('Target terminologies'),
});

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * map_icd10_to_icd11 tool definition
 */
const mapICD10ToICD11Tool: Tool = {
  name: 'map_icd10_to_icd11',
  description: `Map an ICD-10 code to ICD-11.

Use this tool to:
- Find the ICD-11 equivalent of an ICD-10 code
- Migrate from ICD-10 to ICD-11 coding
- Understand how classifications changed between versions

Provide an ICD-10 code like "E11" (Type 2 diabetes) or "I21" (Acute MI).`,
  inputSchema: {
    type: 'object',
    properties: {
      icd10_code: {
        type: 'string',
        description: 'ICD-10 code to map (e.g., E11, I21.0, J18.9)',
      },
    },
    required: ['icd10_code'],
  },
};

/**
 * map_snomed_to_icd10 tool definition
 */
const mapSNOMEDToICD10Tool: Tool = {
  name: 'map_snomed_to_icd10',
  description: `Map a SNOMED CT concept to ICD-10.

Use this tool to:
- Find ICD-10 codes for a SNOMED CT concept
- Support billing and reporting from clinical data
- Cross-reference between clinical and classification systems

Provide a SNOMED CT ID like "73211009" (Diabetes mellitus).

⚠️ SNOMED CT content requires IHTSDO license for production use.`,
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
 * map_loinc_to_snomed tool definition
 */
const mapLOINCToSNOMEDTool: Tool = {
  name: 'map_loinc_to_snomed',
  description: `Map a LOINC code to SNOMED CT.

Use this tool to:
- Find SNOMED CT equivalents for lab tests
- Link observations to clinical concepts
- Support semantic interoperability

Note: Direct LOINC-SNOMED mapping requires UMLS license.
This tool provides guidance on available mapping options.`,
  inputSchema: {
    type: 'object',
    properties: {
      loinc_code: {
        type: 'string',
        description: 'LOINC code (e.g., 2339-0 for Glucose)',
      },
    },
    required: ['loinc_code'],
  },
};

/**
 * find_equivalent tool definition
 */
const findEquivalentTool: Tool = {
  name: 'find_equivalent',
  description: `Search for equivalent terms across multiple medical terminologies.

Use this tool to:
- Find the same concept in different coding systems
- Compare how terminologies represent a concept
- Support terminology mapping and data integration

Searches across: ICD-11, SNOMED CT, LOINC, RxNorm, and MeSH.`,
  inputSchema: {
    type: 'object',
    properties: {
      term: {
        type: 'string',
        description: 'Medical term to search (e.g., "diabetes", "aspirin")',
      },
      source_terminology: {
        type: 'string',
        enum: ['icd11', 'snomed', 'loinc', 'rxnorm', 'mesh'],
        description: 'Optional: specify source terminology',
      },
      target_terminologies: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['icd11', 'snomed', 'loinc', 'rxnorm', 'mesh'],
        },
        description: 'Optional: limit search to specific terminologies',
      },
    },
    required: ['term'],
  },
};

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Handler for map_icd10_to_icd11
 */
async function handleMapICD10ToICD11(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ICD10ToICD11ParamsSchema.parse({
      icd10Code: args.icd10_code,
    });

    const client = getWHOClient();
    const code = params.icd10Code.toUpperCase().trim();

    // Search ICD-11 for the ICD-10 code
    const response = await client.search(code, 'en', 10);
    const results = response.destinationEntities || [];

    const lines: string[] = [];
    lines.push(`# ICD-10 to ICD-11 Mapping`);
    lines.push('');
    lines.push(`**ICD-10 Code:** ${code}`);
    lines.push('');

    if (results.length === 0) {
      lines.push('## No Direct Mapping Found');
      lines.push('');
      lines.push('No direct ICD-11 equivalent found for this ICD-10 code.');
      lines.push('');
      lines.push('**Suggestions:**');
      lines.push('- Try searching by the condition name in ICD-11');
      lines.push('- The concept may have been restructured in ICD-11');
      lines.push('- Check the WHO ICD-11 coding tool for manual mapping');
    } else {
      lines.push('## Potential ICD-11 Matches');
      lines.push('');
      lines.push('| ICD-11 Code | Title | Match Score |');
      lines.push('|-------------|-------|-------------|');

      for (const result of results.slice(0, 10)) {
        const code11 = result.theCode || 'N/A';
        const title = result.title || 'N/A';
        const score = result.score !== undefined ? `${Math.round(result.score * 100)}%` : 'N/A';
        lines.push(`| ${code11} | ${title} | ${score} |`);
      }

      lines.push('');
      lines.push('*Note: These are potential matches based on search. Verify mapping accuracy for clinical use.*');
    }

    return {
      content: [{
        type: 'text',
        text: lines.join('\n'),
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
 * Handler for map_snomed_to_icd10
 */
async function handleMapSNOMEDToICD10(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = SNOMEDToICD10ParamsSchema.parse({
      sctid: args.sctid,
    });

    const client = getSNOMEDClient();

    // First get the concept details
    const concept = await client.getConcept(params.sctid);

    const lines: string[] = [];
    lines.push(`# SNOMED CT to ICD-10 Mapping`);
    lines.push('');
    lines.push(`**SNOMED CT ID:** ${params.sctid}`);

    if (concept) {
      lines.push(`**Preferred Term:** ${concept.pt}`);
    }
    lines.push('');

    // Note about SNOMED-ICD mapping
    lines.push('## Mapping Information');
    lines.push('');
    lines.push('SNOMED CT to ICD-10 mappings are available through:');
    lines.push('');
    lines.push('1. **SNOMED International Map Sets**');
    lines.push('   - Reference Set ID: 447562003 (ICD-10 Complex Map)');
    lines.push('   - Available via Snowstorm API with appropriate license');
    lines.push('');
    lines.push('2. **National Extensions**');
    lines.push('   - US: SNOMED CT to ICD-10-CM maps via NLM');
    lines.push('   - UK: NHS SNOMED-ICD-10 maps');
    lines.push('');

    if (concept) {
      // Try to provide helpful context based on the concept
      lines.push('## Suggested Approach');
      lines.push('');
      lines.push(`For "${concept.pt}", consider:`);
      lines.push('');
      lines.push('1. Search ICD-10 for similar terms');
      lines.push('2. Use the SNOMED hierarchy to find mappable ancestors');
      lines.push('3. Consult official mapping tables from your national authority');
    }

    lines.push('');
    lines.push('---');
    lines.push(SNOMED_DISCLAIMER);

    return {
      content: [{
        type: 'text',
        text: lines.join('\n'),
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
      if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
        return {
          content: [{
            type: 'text',
            text: `# SNOMED CT to ICD-10 Mapping\n\n**SNOMED CT ID:** ${args.sctid}\n\n⚠️ Unable to connect to SNOMED CT server.\n\nSNOMED CT to ICD-10 mappings are available through:\n\n1. **SNOMED International** - Reference Set 447562003\n2. **NLM UMLS** - Requires license\n3. **National Health Services** - Country-specific maps\n\n---\n${SNOMED_DISCLAIMER}`,
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

/**
 * Handler for map_loinc_to_snomed
 */
async function handleMapLOINCToSNOMED(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = LOINCToSNOMEDParamsSchema.parse({
      loincCode: args.loinc_code,
    });

    const client = getNLMClient();

    // Get LOINC details first
    const details = await client.getLOINCDetails(params.loincCode);

    const lines: string[] = [];
    lines.push(`# LOINC to SNOMED CT Mapping`);
    lines.push('');
    lines.push(`**LOINC Code:** ${params.loincCode}`);

    if (details) {
      lines.push(`**Long Common Name:** ${details.LONG_COMMON_NAME}`);
      lines.push(`**Component:** ${details.COMPONENT}`);
    }
    lines.push('');

    lines.push('## Mapping Availability');
    lines.push('');
    lines.push('Direct LOINC to SNOMED CT mappings are **not freely available** via public APIs.');
    lines.push('');
    lines.push('### Available Options:');
    lines.push('');
    lines.push('1. **UMLS Metathesaurus** (requires license)');
    lines.push('   - Contains LOINC-SNOMED relationships');
    lines.push('   - Apply at: https://uts.nlm.nih.gov/uts/');
    lines.push('');
    lines.push('2. **LOINC SNOMED CT Expression Association**');
    lines.push('   - LOINC provides SNOMED CT mappings in downloads');
    lines.push('   - Requires LOINC license (free for most uses)');
    lines.push('   - Download at: https://loinc.org/downloads/');
    lines.push('');
    lines.push('3. **Regenstrief RELMA Tool**');
    lines.push('   - Desktop tool with mapping capabilities');
    lines.push('   - Free download from LOINC.org');
    lines.push('');

    if (details) {
      lines.push('### Suggested SNOMED CT Search');
      lines.push('');
      lines.push(`Based on the LOINC component "${details.COMPONENT}", try searching SNOMED CT for:`);
      lines.push('');
      lines.push(`- \`snomed_search\` with query: "${details.COMPONENT}"`);

      if (details.SYSTEM) {
        lines.push(`- Include specimen/system: "${details.SYSTEM}"`);
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('*This tool provides guidance only. No automated mapping is performed.*');

    return {
      content: [{
        type: 'text',
        text: lines.join('\n'),
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
 * Handler for find_equivalent
 */
async function handleFindEquivalent(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = FindEquivalentParamsSchema.parse({
      term: args.term,
      sourceTerminology: args.source_terminology,
      targetTerminologies: args.target_terminologies,
    });

    const term = params.term;
    const targets = params.targetTerminologies || ['icd11', 'snomed', 'loinc', 'rxnorm', 'mesh'];

    const lines: string[] = [];
    lines.push(`# Cross-Terminology Search: "${term}"`);
    lines.push('');

    const results: Record<string, { found: boolean; items: string[]; error?: string }> = {};

    // Search each terminology in parallel where possible
    const searches: Promise<void>[] = [];

    if (targets.includes('icd11')) {
      searches.push(
        (async () => {
          try {
            const client = getWHOClient();
            const response = await client.search(term, 'en', 5);
            const icdResults = response.destinationEntities || [];
            results['ICD-11'] = {
              found: icdResults.length > 0,
              items: icdResults.slice(0, 5).map(r =>
                `${r.theCode || 'N/A'} - ${r.title || 'N/A'}`
              ),
            };
          } catch (e) {
            results['ICD-11'] = { found: false, items: [], error: e instanceof Error ? e.message : 'Error' };
          }
        })()
      );
    }

    if (targets.includes('snomed')) {
      searches.push(
        (async () => {
          try {
            const client = getSNOMEDClient();
            const snomedResults = await client.searchConcepts(term, true, 5);
            results['SNOMED CT'] = {
              found: snomedResults.length > 0,
              items: snomedResults.map(r => `${r.conceptId} - ${r.pt}`),
            };
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Error';
            if (errMsg.includes('ETIMEDOUT')) {
              results['SNOMED CT'] = { found: false, items: [], error: 'Server unavailable' };
            } else {
              results['SNOMED CT'] = { found: false, items: [], error: errMsg };
            }
          }
        })()
      );
    }

    if (targets.includes('loinc')) {
      searches.push(
        (async () => {
          try {
            const client = getNLMClient();
            const loincResponse = await client.searchLOINC(term, 5);
            const loincResults = loincResponse.items || [];
            results['LOINC'] = {
              found: loincResults.length > 0,
              items: loincResults.map(r => `${r.LOINC_NUM} - ${r.LONG_COMMON_NAME}`),
            };
          } catch (e) {
            results['LOINC'] = { found: false, items: [], error: e instanceof Error ? e.message : 'Error' };
          }
        })()
      );
    }

    if (targets.includes('rxnorm')) {
      searches.push(
        (async () => {
          try {
            const client = getRxNormClient();
            const rxResults = await client.searchDrugs(term);
            results['RxNorm'] = {
              found: rxResults.drugs.length > 0,
              items: rxResults.drugs.slice(0, 5).map(r => `${r.rxcui} - ${r.name}`),
            };
          } catch (e) {
            results['RxNorm'] = { found: false, items: [], error: e instanceof Error ? e.message : 'Error' };
          }
        })()
      );
    }

    if (targets.includes('mesh')) {
      searches.push(
        (async () => {
          try {
            const client = getMeSHClient();
            const meshResults = await client.searchDescriptors(term, 'contains', 5);
            results['MeSH'] = {
              found: meshResults.length > 0,
              items: meshResults.map(r => `${r.id} - ${r.label}`),
            };
          } catch (e) {
            results['MeSH'] = { found: false, items: [], error: e instanceof Error ? e.message : 'Error' };
          }
        })()
      );
    }

    // Wait for all searches to complete
    await Promise.all(searches);

    // Format results
    for (const [terminology, result] of Object.entries(results)) {
      lines.push(`## ${terminology}`);
      lines.push('');

      if (result.error) {
        lines.push(`⚠️ ${result.error}`);
      } else if (!result.found) {
        lines.push('No matches found.');
      } else {
        for (const item of result.items) {
          lines.push(`- ${item}`);
        }
      }
      lines.push('');
    }

    // Summary
    const foundIn = Object.entries(results)
      .filter(([_, r]) => r.found)
      .map(([name, _]) => name);

    lines.push('---');
    lines.push('');
    if (foundIn.length > 0) {
      lines.push(`**Found in:** ${foundIn.join(', ')}`);
    } else {
      lines.push('**No matches found in any terminology.**');
    }

    if (targets.includes('snomed')) {
      lines.push('');
      lines.push(SNOMED_DISCLAIMER);
    }

    return {
      content: [{
        type: 'text',
        text: lines.join('\n'),
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
    throw error;
  }
}

// ============================================================================
// Tool Registration (executed at module load time)
// ============================================================================

// Register all crosswalk tools immediately when this module is imported
toolRegistry.register(mapICD10ToICD11Tool, handleMapICD10ToICD11);
toolRegistry.register(mapSNOMEDToICD10Tool, handleMapSNOMEDToICD10);
toolRegistry.register(mapLOINCToSNOMEDTool, handleMapLOINCToSNOMED);
toolRegistry.register(findEquivalentTool, handleFindEquivalent);
