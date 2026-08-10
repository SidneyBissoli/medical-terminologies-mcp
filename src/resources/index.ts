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

import type { Resource, ReadResourceResult } from '@modelcontextprotocol/server';
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
    hosted_endpoint: 'https://medical.sidneybissoli.com/mcp',
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
through it has its own licenses — **including the two datasets bundled
with the server** (CID-10 V2008 and the WHO ICD-10 → ICD-11 transition
tables), which are NOT covered by the MIT license. Every successful tool
response carries a provenance block (source, URL, data vintage,
extraction instant, citation, license); this resource is the
consolidated notice for the hosted service. The full text ships as
NOTICE.md in the npm package.

## ICD-11 (WHO)
- Licensed under Creative Commons Attribution-NoDerivatives 3.0 IGO
  (CC BY-ND 3.0 IGO), per the ICD-11 Terms of Use and License Agreement
  (https://icd.who.int/en/docs/icd11-license.pdf).
- Required citation: "International Classification of Diseases, Eleventh
  Revision (ICD-11), World Health Organization (WHO) 2019
  https://icd.who.int/browse11. Licensed under the Creative Commons
  Attribution-NoDerivatives 3.0 IGO licence (CC BY-ND 3.0 IGO)."
- This server serves codes and titles together with their URIs, verbatim;
  non-English labels are WHO's own official translations. WHO may
  terminate the license at any time by notice (§4.7).
- Requires free OAuth credentials (\`WHO_CLIENT_ID\` / \`WHO_CLIENT_SECRET\`)
  from icd.who.int/icdapi.

## WHO ICD-10 → ICD-11 transition tables (bundled dataset)
- Format conversion (TSV → JSON, content unaltered) of the tables WHO
  publishes within the ICD-11 release. © World Health Organization,
  under the ICD-11 Terms of Use — not under this project's MIT license.
- WHO guidance: the tables show correspondence between revisions and
  "are not intended for directly converting data from one revision to
  the other."

## CID-10 (DataSUS V2008, Brazilian Portuguese — bundled dataset)
- © World Health Organization; Brazilian Portuguese translation rights
  © CBCD / Faculdade de Saúde Pública da USP; electronic files published
  by DataSUS (Ministério da Saúde do Brasil).
- DataSUS/CBCD permission: developers may use the files with due credit
  and at no charge — this server serves them free, with credit in every
  response's provenance block.
- Dataset frozen at V2008 (no later official Brazilian release).

## LOINC (Regenstrief Institute, via NLM Clinical Tables)
- This material contains content from LOINC (http://loinc.org). LOINC is
  copyright © Regenstrief Institute, Inc. and the Logical Observation
  Identifiers Names and Codes (LOINC) Committee and is available at no
  cost under the license at http://loinc.org/license. LOINC® is a
  registered United States trademark of Regenstrief Institute, Inc.
- Every LOINC code is served with its official display name; terms with
  third-party copyright carry their notice verbatim.
- No authentication required.

## RxNorm (US National Library of Medicine)
- Non-proprietary, public-domain RxNorm content via the RxNav APIs, free
  of charge (RxNav Terms of Service).
- "This product uses publicly available data from the U.S. National
  Library of Medicine (NLM), National Institutes of Health, Department
  of Health and Human Services; NLM is not responsible for the product
  and does not endorse or recommend this or any other product."
- No authentication required.

## ATC (WHO Collaborating Centre for Drug Statistics Methodology,
  served via NLM RxClass)
- ATC classification © WHO Collaborating Centre for Drug Statistics
  Methodology (https://atcddd.fhi.no/); retrieved via NLM RxClass and
  served verbatim. This server never redistributes the WHOCC ATC/DDD
  index itself.
- No authentication required to query.

## MeSH (US National Library of Medicine)
- U.S. government work under the NLM Terms and Conditions, free of
  charge. Courtesy of the U.S. National Library of Medicine.
- No authentication required.

## SNOMED CT (IHTSDO / SNOMED International)
- **Restricted.** Requires a SNOMED CT license. Member countries have
  national licenses covering their residents; use elsewhere (including
  Brazil, a non-member country) requires an IHTSDO license.
- Off by default in this server (\`ENABLE_SNOMED_TOOLS\` flag); this
  server does not bundle SNOMED content — it queries the Snowstorm
  instance the OPERATOR configures, under the operator's own license.
- The server attaches the SNOMED licence disclaimer to every SNOMED
  tool result.

## Important caveat for LLM use

This server is a **lookup layer**, not a clinical decision support
system. Codes returned are *suggested matches* — the LLM should
validate them against clinical context, not present them as
authoritative diagnoses.

## Crosswalk tool status

- \`map_icd10_to_icd11\` returns **authoritative WHO transition-table
  mappings** (release 2025-01, 11,243 categories with documented
  alternatives) — shipped in v1.4.0. Both primary and alternative
  ICD-11 candidates are exposed in \`structuredContent\`.
- \`map_loinc_to_snomed\` and \`map_snomed_to_icd10\` remain
  **guidance-only**: they describe where to obtain authoritative
  mappings (UMLS Metathesaurus, LOINC SNOMED CT Expression
  Association, SNOMED Complex Map refset 447562003) but require
  licensed sources or a self-hosted Snowstorm to actually perform
  the mapping. Both return structured payloads
  (\`status: 'guidance-only'\`, \`authoritative_sources\` /
  \`mapping_sources\` arrays) so LLM clients can present the options
  cleanly. Real refset-backed SNOMED → ICD-10 mapping is tracked as
  PROGRESS.md Phase 13.7.
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
