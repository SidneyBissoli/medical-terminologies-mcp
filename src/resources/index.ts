/**
 * MCP Resources — static/semi-static reference content the client can
 * read by URI. Unlike Tools (which require an external API call) and
 * Prompts (which are templates the LLM expands), Resources are plain
 * data the LLM consults to ground its responses.
 *
 * The URIs use the `info://` scheme as a stable, self-contained
 * namespace; they don't dereference over HTTP. The contents are built
 * once at module-load time from in-process state (server metadata,
 * the bundled CID-10 dataset, the license disclaimers) so the
 * `resources/read` round-trip is sub-millisecond.
 *
 * Side-effect imports: each resource is registered at module load via
 * `resourceRegistry.register(...)`. Add new resources here, then wire
 * the file in BOTH `src/index.ts` and `src/worker.ts`. The meta-test
 * in `src/index.test.ts` enforces the Node side.
 */

import type { Resource, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { resourceRegistry, SERVER_INFO, toolRegistry, type ResourceHandler } from '../server-core.js';
import { getCID10Client } from '../clients/cid10-client.js';
import { SNOMED_TOOLS_ENABLED } from '../utils/feature-flags.js';

// --- info://server -----------------------------------------------------

const serverInfoResource: Resource = {
  uri: 'info://server',
  name: 'Server info',
  description: 'Version, tool count, supported terminologies, and feature-flag state. Useful for LLMs to ground answers about server capabilities.',
  mimeType: 'application/json',
};

const serverInfoHandler: ResourceHandler = async (uri): Promise<ReadResourceResult> => {
  const tools = toolRegistry.getTools();
  const body = {
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    description: SERVER_INFO.description,
    tool_count: tools.length,
    terminologies: [
      'ICD-11 (WHO)',
      'LOINC (NLM)',
      'RxNorm (NIH)',
      'MeSH (NLM)',
      'ATC (via NLM RxClass)',
      'CID-10 (DataSUS V2008, Brazilian Portuguese)',
      `SNOMED CT (${SNOMED_TOOLS_ENABLED ? 'enabled' : 'disabled by default; gated behind ENABLE_SNOMED_TOOLS'})`,
    ],
    snomed_enabled: SNOMED_TOOLS_ENABLED,
    transport_options: ['stdio (default)', 'Streamable HTTP (Node)', 'Cloudflare Workers (hosted)'],
    hosted_endpoint: 'https://medical-terminologies-mcp.sidneybissoli.workers.dev/mcp',
    license: 'MIT (server code); terminology content has its own licenses — see info://licenses',
  };

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(body, null, 2),
      },
    ],
  };
};

resourceRegistry.register(serverInfoResource, serverInfoHandler);

// --- info://cid10/chapters --------------------------------------------

const cid10ChaptersResource: Resource = {
  uri: 'info://cid10/chapters',
  name: 'CID-10 chapters',
  description: 'List of the 22 CID-10 chapters (Brazilian Portuguese ICD-10, DataSUS V2008) with code ranges and Portuguese descriptions. Source: bundled CID-10 dataset.',
  mimeType: 'application/json',
};

const cid10ChaptersHandler: ResourceHandler = async (uri): Promise<ReadResourceResult> => {
  const client = getCID10Client();
  const chapters = client.listChapters();
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            source: 'DataSUS V2008 (bundled)',
            count: chapters.length,
            chapters,
          },
          null,
          2,
        ),
      },
    ],
  };
};

resourceRegistry.register(cid10ChaptersResource, cid10ChaptersHandler);

// --- info://licenses ---------------------------------------------------

const licensesResource: Resource = {
  uri: 'info://licenses',
  name: 'Terminology licenses',
  description: 'Per-terminology license disclaimers and access requirements. Important for downstream redistribution decisions and for surfacing license constraints in LLM answers.',
  mimeType: 'text/markdown',
};

const LICENSES_MARKDOWN = `# Terminology licenses

This MCP server's code is MIT-licensed. The terminology *content* served
through it has its own licenses — most are permissive for research and
clinical use, but SNOMED CT has restrictions worth surfacing in any
downstream answer.

## ICD-11 (WHO)
- Maintained by the World Health Organization.
- Free to use for research and clinical purposes per WHO terms.
- Requires free OAuth credentials (\`WHO_CLIENT_ID\` / \`WHO_CLIENT_SECRET\`)
  from icd.who.int/icdapi.

## LOINC (Regenstrief Institute)
- Free to use without restriction in the United States and many other
  countries. The LOINC license is permissive.
- No authentication required.

## RxNorm (US National Library of Medicine)
- Public domain. No restrictions on use, redistribution, or
  modification.
- No authentication required.

## MeSH (US National Library of Medicine)
- Free to use. Updated annually.
- No authentication required.

## ATC (WHO Collaborating Centre for Drug Statistics Methodology,
  served via NLM RxClass)
- WHO ATC content has license restrictions for commercial redistribution
  but is freely usable for clinical and research lookup.
- NLM RxClass mirrors a subset; no authentication required to query.

## CID-10 (DataSUS V2008, Brazilian Portuguese)
- DataSUS-published, public domain in Brazil. Distributed by the Brazilian
  Ministry of Health.
- Dataset frozen at V2008 (no later official Brazilian release).
- Bundled in the server; no external authentication.

## SNOMED CT (IHTSDO / SNOMED International)
- **Restricted.** Requires a SNOMED CT license. Member countries have
  national licenses covering their residents; commercial use elsewhere
  requires a separate IHTSDO license.
- Off by default in this server (\`ENABLE_SNOMED_TOOLS\` flag).
- Operator must self-host a Snowstorm instance (the historical public
  endpoint was retired in 2026).
- The server attaches the SNOMED licence disclaimer to every SNOMED
  tool result.

## Important caveat for LLM use

This server is a **lookup layer**, not a clinical decision support
system. Codes returned are *suggested matches* — the LLM should
validate them against clinical context, not present them as
authoritative diagnoses.

The \`map_icd10_to_icd11\` tool today is a text-search heuristic, not
an authoritative WHO transition table mapping. The
\`map_loinc_to_snomed\` and \`map_snomed_to_icd10\` tools return
guidance only — they do not perform authoritative concept mappings.
Real authoritative mappings are planned but not yet implemented.
`;

const licensesHandler: ResourceHandler = async (uri): Promise<ReadResourceResult> => {
  return {
    contents: [
      {
        uri,
        mimeType: 'text/markdown',
        text: LICENSES_MARKDOWN,
      },
    ],
  };
};

resourceRegistry.register(licensesResource, licensesHandler);
