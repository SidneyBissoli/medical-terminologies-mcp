/**
 * Crosswalk Tools for Medical Terminologies MCP Server
 *
 * - map_icd10_to_icd11: Map ICD-10 codes to ICD-11
 * - map_snomed_to_icd10: Map SNOMED CT to ICD-10
 * - map_loinc_to_snomed: Map LOINC to SNOMED CT
 * - find_equivalent: Search for equivalent terms across terminologies
 *
 * Note: Some mappings may not be freely available. Tools return explanatory
 * messages when mappings are unavailable.
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toolRegistry } from '../server.js';
import { getWHOClient } from '../clients/who-client.js';
import { getSNOMEDClient, SNOMED_DISCLAIMER } from '../clients/snomed-client.js';
import { getNLMClient } from '../clients/nlm-client.js';
import { getRxNormClient } from '../clients/rxnorm-client.js';
import { getMeSHClient } from '../clients/mesh-client.js';
import { ApiError } from '../types/index.js';
import {
  MapICD10ToICD11ParamsSchema,
  MapSNOMEDToICD10ParamsSchema,
  MapLOINCToSNOMEDParamsSchema,
  FindEquivalentParamsSchema,
} from '../types/index.js';
import { buildInputSchema, handleToolError } from '../utils/zod-schema.js';

// ============================================================================
// Tool Definitions
// ============================================================================

const mapICD10ToICD11Tool: Tool = {
  name: 'map_icd10_to_icd11',
  description: `This tool runs the ICD-10 code as a query string against the ICD-11 search index. The search matches the code against ICD-11 entity titles, definitions, and synonyms; it does not consult any curated ICD-10 → ICD-11 mapping. Results are search hits, not authoritative mappings.

For authoritative ICD-10 → ICD-11 mappings (clinical coding, billing, migration projects), consult the WHO transition tables at https://icd.who.int/browse11/Downloads/Download.

Use this tool for exploratory lookups: confirming a code exists in ICD-11 text, finding ICD-11 entities whose descriptions reference an ICD-10 code, or seeding a manual mapping review. Do not present the results as ICD-10 → ICD-11 equivalents to clinical or billing consumers.

Provide a code like "E11" (Type 2 diabetes) or "I21" (Acute MI).`,
  inputSchema: buildInputSchema(MapICD10ToICD11ParamsSchema),
};

const mapSNOMEDToICD10Tool: Tool = {
  name: 'map_snomed_to_icd10',
  description: `Map a SNOMED CT concept to ICD-10.

Use this tool to:
- Find ICD-10 codes for a SNOMED CT concept
- Support billing and reporting from clinical data
- Cross-reference between clinical and classification systems

Provide a SNOMED CT ID like "73211009" (Diabetes mellitus).

⚠️ SNOMED CT content requires IHTSDO license for production use.`,
  inputSchema: buildInputSchema(MapSNOMEDToICD10ParamsSchema),
};

const mapLOINCToSNOMEDTool: Tool = {
  name: 'map_loinc_to_snomed',
  description: `Map a LOINC code to SNOMED CT.

Use this tool to:
- Find SNOMED CT equivalents for lab tests
- Link observations to clinical concepts
- Support semantic interoperability

Note: Direct LOINC-SNOMED mapping requires UMLS license.
This tool provides guidance on available mapping options.`,
  inputSchema: buildInputSchema(MapLOINCToSNOMEDParamsSchema),
};

const findEquivalentTool: Tool = {
  name: 'find_equivalent',
  description: `Search for equivalent terms across multiple medical terminologies.

Use this tool to:
- Find the same concept in different coding systems
- Compare how terminologies represent a concept
- Support terminology mapping and data integration

Searches across: ICD-11, SNOMED CT, LOINC, RxNorm, and MeSH.`,
  inputSchema: buildInputSchema(FindEquivalentParamsSchema),
};

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleMapICD10ToICD11(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MapICD10ToICD11ParamsSchema.parse(args);
    const client = getWHOClient();
    const code = params.icd10_code.toUpperCase().trim();

    const response = await client.search(code, 'en', 10);
    const results = response.destinationEntities || [];

    const lines: string[] = [];
    lines.push(`# ICD-11 search results for ICD-10 code "${code}"`);
    lines.push('');
    lines.push(
      `This output is a text search of the ICD-11 catalog using "${code}" as the query string. The hits below are ICD-11 entities whose titles, definitions, or synonyms contain that string. They are not curated ICD-10 → ICD-11 mappings. For authoritative mappings, use the WHO transition tables: https://icd.who.int/browse11/Downloads/Download.`,
    );
    lines.push('');

    if (results.length === 0) {
      lines.push('## No search hits');
      lines.push('');
      lines.push('Nothing in the ICD-11 catalog matched this code as a text query.');
      lines.push('');
      lines.push('**Next steps:**');
      lines.push('- Try `icd11_search` with the condition name instead of the ICD-10 code');
      lines.push('- The concept may have been restructured between revisions');
      lines.push('- Consult the WHO transition tables linked above');
    } else {
      lines.push(`## Search hits (${Math.min(results.length, 10)} shown)`);
      lines.push('');
      lines.push('| ICD-11 Code | Title |');
      lines.push('|-------------|-------|');

      for (const result of results.slice(0, 10)) {
        const code11 = result.theCode || 'N/A';
        const title = result.title || 'N/A';
        lines.push(`| ${code11} | ${title} |`);
      }

      lines.push('');
      lines.push(
        'These are search candidates intended for manual review. To assign an ICD-11 code for clinical coding or billing, verify each candidate against the WHO transition tables linked above.',
      );
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleMapSNOMEDToICD10(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MapSNOMEDToICD10ParamsSchema.parse(args);
    const client = getSNOMEDClient();
    const concept = await client.getConcept(params.sctid);

    const lines: string[] = [];
    lines.push(`# SNOMED CT to ICD-10 Mapping`);
    lines.push('');
    lines.push(`**SNOMED CT ID:** ${params.sctid}`);

    if (concept) {
      lines.push(`**Preferred Term:** ${concept.pt}`);
    }
    lines.push('');

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
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error) {
    if (error instanceof ApiError && (error.message.includes('ETIMEDOUT') || error.message.includes('timeout'))) {
      return {
        content: [{
          type: 'text',
          text: `# SNOMED CT to ICD-10 Mapping\n\n**SNOMED CT ID:** ${args.sctid}\n\n⚠️ Unable to connect to SNOMED CT server.\n\nSNOMED CT to ICD-10 mappings are available through:\n\n1. **SNOMED International** - Reference Set 447562003\n2. **NLM UMLS** - Requires license\n3. **National Health Services** - Country-specific maps\n\n---\n${SNOMED_DISCLAIMER}`,
        }],
      };
    }
    return handleToolError(error);
  }
}

async function handleMapLOINCToSNOMED(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MapLOINCToSNOMEDParamsSchema.parse(args);
    const client = getNLMClient();
    const details = await client.getLOINCDetails(params.loinc_code);

    const lines: string[] = [];
    lines.push(`# LOINC to SNOMED CT Mapping`);
    lines.push('');
    lines.push(`**LOINC Code:** ${params.loinc_code}`);

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
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleFindEquivalent(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = FindEquivalentParamsSchema.parse(args);
    const term = params.term;
    const targets = params.target_terminologies || ['icd11', 'snomed', 'loinc', 'rxnorm', 'mesh'];

    const lines: string[] = [];
    lines.push(`# Cross-Terminology Search: "${term}"`);
    lines.push('');

    const results: Record<string, { found: boolean; items: string[]; error?: string }> = {};

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
              items: icdResults.slice(0, 5).map((r) => `${r.theCode || 'N/A'} - ${r.title || 'N/A'}`),
            };
          } catch (e) {
            results['ICD-11'] = { found: false, items: [], error: e instanceof Error ? e.message : 'Error' };
          }
        })(),
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
              items: snomedResults.map((r) => `${r.conceptId} - ${r.pt}`),
            };
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Error';
            results['SNOMED CT'] = {
              found: false,
              items: [],
              error: errMsg.includes('ETIMEDOUT') ? 'Server unavailable' : errMsg,
            };
          }
        })(),
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
              items: loincResults.map((r) => `${r.LOINC_NUM} - ${r.LONG_COMMON_NAME}`),
            };
          } catch (e) {
            results['LOINC'] = { found: false, items: [], error: e instanceof Error ? e.message : 'Error' };
          }
        })(),
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
              items: rxResults.drugs.slice(0, 5).map((r) => `${r.rxcui} - ${r.name}`),
            };
          } catch (e) {
            results['RxNorm'] = { found: false, items: [], error: e instanceof Error ? e.message : 'Error' };
          }
        })(),
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
              items: meshResults.map((r) => `${r.id} - ${r.label}`),
            };
          } catch (e) {
            results['MeSH'] = { found: false, items: [], error: e instanceof Error ? e.message : 'Error' };
          }
        })(),
      );
    }

    await Promise.all(searches);

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

    const foundIn = Object.entries(results)
      .filter(([, r]) => r.found)
      .map(([name]) => name);

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
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error) {
    return handleToolError(error);
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

toolRegistry.register(mapICD10ToICD11Tool, handleMapICD10ToICD11);
toolRegistry.register(mapSNOMEDToICD10Tool, handleMapSNOMEDToICD10);
toolRegistry.register(mapLOINCToSNOMEDTool, handleMapLOINCToSNOMED);
toolRegistry.register(findEquivalentTool, handleFindEquivalent);
