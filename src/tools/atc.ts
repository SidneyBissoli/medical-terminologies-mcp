/**
 * ATC (Anatomical Therapeutic Chemical) Tools
 *
 * - atc_classify: Drug name → ATC code(s)
 * - atc_lookup:   ATC code (level 1-4) → name and level type
 * - atc_members:  ATC code → drugs in that class
 *
 * Backed by NLM RxClass (rxnav.nlm.nih.gov), which envelopes the WHOCC
 * ATC index. Same host as RxNorm proper, so requests share the rxnorm
 * rate limiter, retry policy, and cache.
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toolRegistry } from '../server-core.js';
import { getRxNormClient } from '../clients/rxnorm-client.js';
import {
  ATCClassifyParamsSchema,
  ATCByCodeParamsSchema,
  ATCMembersParamsSchema,
  ATCClassifyOutputSchema,
  ATCLookupOutputSchema,
  ATCMembersOutputSchema,
  ATCClassifyOutput,
  ATCLookupOutput,
  ATCMembersOutput,
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

const atcClassifyTool: Tool = {
  name: 'atc_classify',
  description: `Look up the WHO ATC (Anatomical Therapeutic Chemical) classification(s) for a drug by name.

Use this tool to:
- Find the ATC code for a medication (e.g., "metformin" → A10BA02)
- Identify the therapeutic and pharmacological class hierarchy
- Cross-reference drugs with their international ATC codes

Returns one entry per ATC code the drug belongs to. A single-ingredient drug typically maps to one substance-level code; combination products map to multiple. ATC codes are international (WHO Collaborating Centre); this tool retrieves them via NLM RxClass.`,
  inputSchema: buildInputSchema(ATCClassifyParamsSchema),
  outputSchema: buildOutputSchema(ATCClassifyOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const atcLookupTool: Tool = {
  name: 'atc_lookup',
  description: `Look up an ATC code at level 1-4 to get its name and hierarchy level.

Use this tool to:
- Resolve an ATC code (e.g., "A10BA") to its class name ("Biguanides")
- Confirm a code exists in the current ATC index
- Identify the level (anatomical / therapeutic / pharmacological / chemical)

Accepts codes 1-5 characters long: "A" (anatomical), "A10" (therapeutic), "A10B" (pharmacological), "A10BA" (chemical). Substance-level codes (7 chars, e.g., "A10BA02") are not exposed by this endpoint — use atc_classify with the drug name to retrieve the substance code.`,
  inputSchema: buildInputSchema(ATCByCodeParamsSchema),
  outputSchema: buildOutputSchema(ATCLookupOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const atcMembersTool: Tool = {
  name: 'atc_members',
  description: `List the drugs (substances) that belong to an ATC class.

Use this tool to:
- Enumerate all members of a therapeutic class (e.g., "A10BA" → metformin, phenformin)
- Build a list of drugs sharing a pharmacological mechanism
- Explore an ATC subtree at any level

Each member includes its substance-level (7-char) ATC code via source_atc_code, useful for disambiguation when the queried class is at level 1-4. RxNorm's catalog is US-centric; the ATC class names and codes themselves are international.`,
  inputSchema: buildInputSchema(ATCMembersParamsSchema),
  outputSchema: buildOutputSchema(ATCMembersOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleATCClassify(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ATCClassifyParamsSchema.parse(args);
    const client = getRxNormClient();
    const matches = await client.getATCByDrugName(params.drug_name);

    const structured: ATCClassifyOutput = {
      drug_name: params.drug_name,
      matches,
    };

    if (matches.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No ATC classification found for "${params.drug_name}". The drug may be unknown to RxNorm or have no ATC mapping.`,
          },
        ],
        structuredContent: structured,
      };
    }

    const lines: string[] = [];
    lines.push(`# ATC classification for "${params.drug_name}"`);
    lines.push('');
    lines.push(`Found ${matches.length} ATC code${matches.length === 1 ? '' : 's'}:`);
    lines.push('');
    lines.push('| ATC code | Class name | Drug (RxNorm) | TTY |');
    lines.push('|----------|------------|---------------|-----|');
    for (const m of matches) {
      lines.push(
        `| ${m.atc_code} | ${m.atc_name} | ${m.drug_name} | ${m.tty} |`,
      );
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleATCLookup(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ATCByCodeParamsSchema.parse(args);
    const client = getRxNormClient();
    const details = await client.getATCByCode(params.atc_code);

    const structured: ATCLookupOutput = {
      atc_code: params.atc_code,
      found: details !== null,
      details,
    };

    if (!details) {
      return {
        content: [
          {
            type: 'text',
            text: `# ATC code "${params.atc_code}" not found at level 1-4.\n\nIf this is a 7-character substance code (e.g., "A10BA02"), use atc_classify with the drug name instead — RxClass byId only exposes ATC1-4 codes.`,
          },
        ],
        structuredContent: structured,
      };
    }

    const lines: string[] = [
      `# ATC ${details.atc_code} — ${details.atc_name}`,
      '',
      `**Level:** ${details.atc_level_type}`,
    ];

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleATCMembers(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ATCMembersParamsSchema.parse(args);
    const client = getRxNormClient();
    const members = await client.getATCMembers(params.atc_code);

    const structured: ATCMembersOutput = {
      atc_code: params.atc_code,
      members,
    };

    if (members.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `# ATC ${params.atc_code} has no member drugs.\n\nThe code may be unknown, or the class may have no RxNorm-mapped substances.`,
          },
        ],
        structuredContent: structured,
      };
    }

    const lines: string[] = [];
    lines.push(`# Members of ATC class ${params.atc_code}`);
    lines.push('');
    lines.push(`Found ${members.length} member${members.length === 1 ? '' : 's'}:`);
    lines.push('');
    lines.push('| Substance ATC | RxCUI | Name | TTY |');
    lines.push('|---------------|-------|------|-----|');
    for (const m of members) {
      lines.push(
        `| ${m.source_atc_code || '—'} | ${m.rxcui} | ${m.name} | ${m.tty} |`,
      );
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

toolRegistry.register(atcClassifyTool, handleATCClassify);
toolRegistry.register(atcLookupTool, handleATCLookup);
toolRegistry.register(atcMembersTool, handleATCMembers);
