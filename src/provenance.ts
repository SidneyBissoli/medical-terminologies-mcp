/**
 * Provenance block (portfolio contract v1.0) — English/UTC adapter over
 * `@sbissoli/mcp-provenance`. The canonical model, the `concise`/`detailed`
 * projections, serialization determinism, timezone handling and the footer
 * wording live in the package; this module binds them to this server:
 *
 *  - one `ProvenanceContext` for the whole server (namespace
 *    `com.sidneybissoli.medical`, English footer, UTC, `concise` mode —
 *    the product is English-facing);
 *  - the source registry (`MEDICAL_SOURCES`) — one preset per upstream the
 *    37 tools consume, with `license`/`citation` taken from the verbatim
 *    terms verification of the fase medical (medical/docs/01, 2026-08-08);
 *  - `medicalProvenance(...)`, the per-call builder every tool uses. It
 *    pulls the REAL extraction instant (`retrieved_at`) and
 *    `served_from_cache` from the cache layer via the ambient fetch-meta
 *    collector (`src/utils/fetch-meta.ts`): cache hits keep the original
 *    fetch instant — the legally relevant extraction date. Bundled
 *    datasets (CID-10, transition tables) have no fetch: `retrieved_at`
 *    is the in-memory query instant and the authority lives in
 *    `data_vintage` (V2008 / 2025-01).
 *
 * Multi-source responses (`find_equivalent`, `validate_codes`) carry ONE
 * BLOCK PER SOURCE (license segregation is a contract rule); their
 * `structuredContent.provenance` is an array. `derived` semantics: raw
 * upstream data that is only reshaped → `false`; server-computed values
 * (the `match_score`/`rank`/`groups` of find_equivalent, the transition-
 * table summary statistics of terminology_diff) → `true` + a
 * `derivation_note` saying exactly what the server did.
 *
 * Emission: `provenancedResult(...)` renders the three channels —
 * `structuredContent.provenance` + `attribution` (parseable, visible to
 * the model), `_meta` mirror under namespaced keys (out-of-band, zero
 * model tokens), and the compact text footer appended to the Markdown.
 */

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import {
  attributionList,
  createProvenanceContext,
  renderConcise,
  type CanonicalProvenance,
  type ConciseBlock,
} from '@sbissoli/mcp-provenance';
import { cacheMetaFor, type FetchMeta } from './utils/fetch-meta.js';
import { getEnv } from './utils/env.js';

/** Single provenance context for the server: `_meta` namespace, locale, timezone, mode. */
export const provenanceContext = createProvenanceContext({
  metaNamespace: 'com.sidneybissoli.medical',
  locale: 'en',
  timezone: 'utc',
  defaultMode: 'concise',
});

/** Canonical envelope v1.0 (post-validation). */
export type Provenance = CanonicalProvenance;

/** Namespaced `_meta` keys (stable — audit/UI consumers read by these keys). */
export const PROVENANCE_META_KEY = provenanceContext.metaKeys.provenance;
export const ATTRIBUTION_META_KEY = provenanceContext.metaKeys.attribution;

interface LicenseSpec {
  id: string | null;
  name: string;
  url: string | null;
  terms_url: string | null;
  verified_at: string;
}

interface MedicalSource {
  name: string;
  agency: string | null;
  database: string | null;
  /** Base endpoint effectively queried (null for bundled datasets). */
  endpoint: string | null;
  /** Canonical URL of the source (API base or dataset release page). */
  sourceUrl: () => string;
  license: LicenseSpec;
  /** Ready-to-use citation. `date` = retrieval date (UTC, YYYY-MM-DD). */
  citation: (date: string, detail?: string) => string;
  /** Verbatim upstream notices that accompany the data (detailed mode). */
  notices: string[];
  /** Cache prefixes whose accesses belong to this source ([] = bundled). */
  cachePrefixes: string[];
  /** Default data_vintage when the caller does not pass one. */
  defaultVintage: () => string | null;
}

/** Verbatim verification date of every license below (medical/docs/01). */
const VERIFIED_AT = '2026-08-08';

/**
 * NLM attribution statement — required wording from the RxNav Terms of
 * Service, reproduced verbatim (docs/01 §3). Shared by the RxNorm, ATC
 * (RxClass), MeSH, and ClinicalTables presets.
 */
export const NLM_STATEMENT =
  'This product uses publicly available data from the U.S. National Library of Medicine (NLM), ' +
  'National Institutes of Health, Department of Health and Human Services; NLM is not responsible ' +
  'for the product and does not endorse or recommend this or any other product.';

/**
 * LOINC §10 notice — required verbatim by the LOINC License for online
 * terminology services (docs/01 §6). Also reproduced in NOTICE.md, the
 * README, and the `info://licenses` resource.
 */
export const LOINC_NOTICE =
  'This material contains content from LOINC (http://loinc.org). LOINC is copyright © Regenstrief ' +
  'Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee and ' +
  'is available at no cost under the license at http://loinc.org/license. LOINC® is a registered ' +
  'United States trademark of Regenstrief Institute, Inc.';

/**
 * Source registry — one preset per upstream. Never use the WHO name or
 * emblem as endorsement (ICD-11 license §4.1); text-only attribution.
 */
export const MEDICAL_SOURCES = {
  WHO_ICD_API: {
    name: 'WHO ICD-API (ICD-11)',
    agency: 'WHO',
    database: 'ICD-11 MMS',
    endpoint: 'https://id.who.int/icd',
    sourceUrl: () => 'https://id.who.int/icd',
    license: {
      id: 'CC-BY-ND-3.0-IGO',
      name: 'Creative Commons Attribution-NoDerivatives 3.0 IGO (ICD-11 Terms of Use and License Agreement)',
      url: 'https://creativecommons.org/licenses/by-nd/3.0/igo/',
      terms_url: 'https://icd.who.int/en/docs/icd11-license.pdf',
      verified_at: VERIFIED_AT,
    },
    // §1.3 of the ICD-11 license fixes this citation; the retrieval clause
    // is additive (marked as ours per §1.2.5).
    citation: (date: string) =>
      'International Classification of Diseases, Eleventh Revision (ICD-11), World Health ' +
      'Organization (WHO) 2019. https://icd.who.int/browse11. Licensed under the Creative Commons ' +
      'Attribution-NoDerivatives 3.0 IGO licence (CC BY-ND 3.0 IGO). ' +
      `Retrieved via the WHO ICD-API on ${date}.`,
    notices: [
      'ICD-11 content is served verbatim with code, title, and URI preserved (license §1.2.2–1.2.3).',
    ],
    cachePrefixes: ['icd11'],
    defaultVintage: () => getEnv('WHO_ICD11_RELEASE_ID') ?? '2026-01',
  },
  WHO_TRANSITION_TABLES: {
    name: 'WHO ICD-10 → ICD-11 transition tables (bundled)',
    agency: 'WHO',
    database: 'ICD-11 release files',
    endpoint: null,
    sourceUrl: () => 'https://icdcdn.who.int/static/releasefiles/2025-01/mapping.zip',
    license: {
      id: 'CC-BY-ND-3.0-IGO',
      name: 'ICD-11 Terms of Use and License Agreement (tables published within the ICD-11 release; the ICD-10 layer remains © WHO under its case-by-case licensing regime)',
      url: 'https://creativecommons.org/licenses/by-nd/3.0/igo/',
      terms_url: 'https://icd.who.int/en/docs/icd11-license.pdf',
      verified_at: VERIFIED_AT,
    },
    citation: (date: string, detail?: string) =>
      `WHO ICD-10 → ICD-11 transition tables, release ${detail ?? '2025-01'}, World Health ` +
      'Organization. Bundled dataset (TSV → JSON, content unaltered: codes, titles, and URIs ' +
      `preserved). Queried in-process on ${date}.`,
    notices: [
      'WHO: "Mapping tables show the correspondence between ICD-10 and ICD-11 codes. They are not intended for directly converting data from one revision to the other."',
    ],
    cachePrefixes: [],
    defaultVintage: () => null, // caller passes the live dataset version
  },
  DATASUS_CID10: {
    name: 'CID-10 V2008 (DataSUS, bundled)',
    agency: 'Ministério da Saúde do Brasil — DataSUS',
    database: 'CID-10 V2008',
    endpoint: null,
    sourceUrl: () => 'http://www2.datasus.gov.br/cid10/V2008/',
    license: {
      id: null,
      name: 'DataSUS CID-10 V2008 copyright terms — free use by system developers with credit and at no charge (© WHO; Brazilian Portuguese translation © CBCD/USP)',
      url: null,
      terms_url: 'http://www2.datasus.gov.br/cid10/V2008/copyright.htm',
      verified_at: VERIFIED_AT,
    },
    citation: (date: string) =>
      'CID-10 V2008 — Classificação Estatística Internacional de Doenças, 10ª Revisão. DataSUS / ' +
      'Ministério da Saúde do Brasil; Brazilian Portuguese translation by CBCD/USP; © World Health ' +
      `Organization. http://www2.datasus.gov.br/cid10/V2008/. Queried in-process on ${date}.`,
    notices: [],
    cachePrefixes: [],
    defaultVintage: () => 'V2008',
  },
  NLM_RXNAV: {
    name: 'RxNorm (NLM RxNav API)',
    agency: 'U.S. National Library of Medicine',
    database: 'RxNorm',
    endpoint: 'https://rxnav.nlm.nih.gov/REST',
    sourceUrl: () => 'https://rxnav.nlm.nih.gov/REST',
    license: {
      id: null,
      name: 'Public-domain RxNorm content served free of charge via the NLM RxNav API (NLM Terms of Service)',
      url: null,
      terms_url: 'https://lhncbc.nlm.nih.gov/RxNav/TermsofService.html',
      verified_at: VERIFIED_AT,
    },
    citation: (date: string) =>
      `RxNorm, U.S. National Library of Medicine. Retrieved via the NLM RxNav API on ${date}.`,
    notices: [NLM_STATEMENT],
    cachePrefixes: ['rxnorm'],
    defaultVintage: () => null,
  },
  NLM_RXCLASS_ATC: {
    name: 'ATC via NLM RxClass',
    agency: 'U.S. National Library of Medicine',
    database: 'RxClass (WHO ATC)',
    endpoint: 'https://rxnav.nlm.nih.gov/REST',
    sourceUrl: () => 'https://rxnav.nlm.nih.gov/REST',
    license: {
      id: null,
      name: 'NLM Terms of Service (RxClass); ATC classification © WHO Collaborating Centre for Drug Statistics Methodology',
      url: null,
      terms_url: 'https://lhncbc.nlm.nih.gov/RxNav/TermsofService.html',
      verified_at: VERIFIED_AT,
    },
    citation: (date: string) =>
      'ATC classification © WHO Collaborating Centre for Drug Statistics Methodology, served via ' +
      `NLM RxClass. Retrieved on ${date}.`,
    notices: [NLM_STATEMENT],
    // ATC shares the RxNorm client/host, so its accesses land on the same
    // cache prefix; the aggregation is per-host, which is honest here.
    cachePrefixes: ['rxnorm'],
    defaultVintage: () => null,
  },
  NLM_MESH: {
    name: 'MeSH (NLM Linked Data API)',
    agency: 'U.S. National Library of Medicine',
    database: 'MeSH RDF',
    endpoint: 'https://id.nlm.nih.gov/mesh',
    sourceUrl: () => 'https://id.nlm.nih.gov/mesh',
    license: {
      id: null,
      name: 'NLM Terms and Conditions — U.S. government work, no charges or royalties; credit "Courtesy of the U.S. National Library of Medicine" required',
      url: null,
      terms_url: 'https://www.nlm.nih.gov/databases/download/terms_and_conditions.html',
      verified_at: VERIFIED_AT,
    },
    citation: (date: string) =>
      'MeSH (Medical Subject Headings). Courtesy of the U.S. National Library of Medicine. ' +
      `Retrieved via the MeSH Linked Data API on ${date}.`,
    notices: [NLM_STATEMENT],
    cachePrefixes: ['mesh'],
    defaultVintage: () => null,
  },
  CLINICALTABLES_LOINC: {
    name: 'LOINC via NLM Clinical Tables',
    agency: 'U.S. National Library of Medicine',
    database: 'Clinical Tables (LOINC)',
    endpoint: 'https://clinicaltables.nlm.nih.gov/api',
    sourceUrl: () => 'https://clinicaltables.nlm.nih.gov/api',
    license: {
      id: null,
      name: 'LOINC License (content © Regenstrief Institute, Inc. and the LOINC Committee; served via the free NLM Clinical Tables API)',
      url: 'https://loinc.org/license/',
      terms_url: 'https://clinicaltables.nlm.nih.gov/',
      verified_at: VERIFIED_AT,
    },
    citation: (date: string) =>
      `LOINC content retrieved via the NLM Clinical Tables API on ${date}. ${LOINC_NOTICE}`,
    notices: [LOINC_NOTICE, NLM_STATEMENT],
    cachePrefixes: ['loinc'],
    defaultVintage: () => null,
  },
  SNOMED_SNOWSTORM: {
    name: 'SNOMED CT (operator-configured Snowstorm)',
    agency: 'SNOMED International',
    database: 'SNOMED CT',
    endpoint: null, // resolved per call from SNOMED_BASE_URL
    sourceUrl: () => getEnv('SNOMED_BASE_URL') ?? 'https://www.snomed.org/',
    license: {
      id: null,
      name: 'SNOMED CT — served through the Snowstorm instance configured by the operator, under the OPERATOR\'s SNOMED CT license (IHTSDO Affiliate License; Brazil is not a SNOMED member country)',
      url: null,
      terms_url: 'https://www.snomed.org/get-snomed',
      verified_at: VERIFIED_AT,
    },
    citation: (date: string) =>
      'SNOMED CT, SNOMED International (IHTSDO), served via the operator-configured Snowstorm ' +
      `instance. Retrieved on ${date}. SNOMED CT content is for reference only; production use ` +
      'requires a SNOMED CT license.',
    notices: [],
    cachePrefixes: ['snomed'],
    defaultVintage: () => null,
  },
  SERVER_METADATA: {
    name: 'medical-terminologies-mcp (server-maintained metadata)',
    agency: null,
    database: null,
    endpoint: null,
    sourceUrl: () => 'https://github.com/SidneyBissoli/medical-terminologies-mcp',
    license: {
      id: 'MIT',
      name: 'MIT (server code and server-maintained metadata; terminology content keeps its own licenses)',
      url: 'https://github.com/SidneyBissoli/medical-terminologies-mcp/blob/main/LICENSE',
      terms_url: null,
      verified_at: VERIFIED_AT,
    },
    citation: (date: string) =>
      'medical-terminologies-mcp — server-maintained metadata (not terminology content). ' +
      `https://github.com/SidneyBissoli/medical-terminologies-mcp. Generated on ${date}.`,
    notices: [],
    cachePrefixes: [],
    defaultVintage: () => null,
  },
} satisfies Record<string, MedicalSource>;

export type MedicalSourceKey = keyof typeof MEDICAL_SOURCES;

export interface MedicalProvenanceOptions {
  /** Dataset identity within the source (e.g. bundled dataset version). */
  dataset?: { id?: string | null; version?: string | null; name?: string | null };
  /** Version/release of the data as exposed by the source. */
  dataVintage?: string | null;
  /** Extra detail interpolated into the citation (e.g. dataset release). */
  citationDetail?: string;
  /** Server-side derivation: what was computed beyond reshaping. */
  derived?: { note: string };
}

/**
 * Builds the canonical provenance block for one source of one tool
 * response. `retrieved_at`/`served_from_cache` come from the ambient
 * fetch-meta collector, filtered to the source's cache prefixes.
 */
export function medicalProvenance(
  key: MedicalSourceKey,
  opts: MedicalProvenanceOptions = {},
): Provenance {
  const src: MedicalSource = MEDICAL_SOURCES[key];
  const meta: FetchMeta = cacheMetaFor(src.cachePrefixes);
  const date = meta.retrievedAt.toISOString().slice(0, 10);

  return provenanceContext.build({
    source: {
      name: src.name,
      agency: src.agency,
      database: src.database,
      endpoint: key === 'SNOMED_SNOWSTORM' ? (getEnv('SNOMED_BASE_URL') ?? null) : src.endpoint,
    },
    source_url: src.sourceUrl(),
    ...(opts.dataset !== undefined
      ? {
          dataset: {
            id: opts.dataset.id ?? null,
            version: opts.dataset.version ?? null,
            name: opts.dataset.name ?? null,
          },
        }
      : {}),
    data_vintage: opts.dataVintage !== undefined ? opts.dataVintage : src.defaultVintage(),
    retrieved_at: meta.retrievedAt,
    citation: src.citation(date, opts.citationDetail),
    license: src.license,
    notices: src.notices,
    derived: opts.derived !== undefined,
    ...(opts.derived !== undefined ? { derivation_note: opts.derived.note } : {}),
    served_from_cache: src.cachePrefixes.length === 0 ? null : meta.servedFromCache,
  });
}

/**
 * Assembles the full MCP success result with the three provenance
 * channels. `text` is the tool's Markdown (footer appended); `structured`
 * is the tool's typed payload (`provenance` + `attribution` appended).
 * Pass an ARRAY of blocks for multi-source responses — the wire shape
 * follows the input shape (object vs array), matching the tool's
 * outputSchema (`withProvenance` vs `withProvenanceMulti`).
 */
export function provenancedResult(opts: {
  text: string;
  structured: Record<string, unknown>;
  provenance: Provenance | Provenance[];
}): CallToolResult {
  const blocks = Array.isArray(opts.provenance) ? opts.provenance : [opts.provenance];
  if (blocks.length === 0) {
    throw new Error('provenancedResult requires at least one provenance block');
  }
  const rendered = blocks.map((b) => renderConcise(b));
  const provOut: ConciseBlock | ConciseBlock[] = Array.isArray(opts.provenance)
    ? rendered
    : rendered[0];
  const attribution = attributionList(blocks);
  return {
    content: [{ type: 'text', text: `${opts.text}\n\n${provenanceContext.footer(blocks)}` }],
    structuredContent: { ...opts.structured, provenance: provOut, attribution },
    _meta: {
      [PROVENANCE_META_KEY]: provOut,
      [ATTRIBUTION_META_KEY]: attribution,
    },
  };
}

/** Concise projection of a block (the shape embedded in `structuredContent`/`_meta`). */
export const provenanceBlockSchema = z.object({
  source: z.string().describe('Official upstream source of this data'),
  source_url: z.string().describe('Canonical URL of the source (API base or dataset release)'),
  data_vintage: z
    .string()
    .nullable()
    .describe('Version/release of the data as exposed by the source; null when not exposed'),
  retrieved_at: z
    .string()
    .describe(
      'Real instant of the upstream extraction (ISO-8601, UTC). Responses served from cache keep the ORIGINAL fetch instant.',
    ),
  citation: z.string().describe('Ready-to-use citation/attribution string'),
  license: z.string().nullable().describe('License / legal regime of the data'),
});

/**
 * Extends a single-source tool's output schema with the provenance channel
 * of the contract v1.0: the concise block + the `attribution` URL list
 * (MCP RFC #711). Every successful response carries both.
 */
export function withProvenance<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.extend({
    provenance: provenanceBlockSchema.describe(
      'Provenance block (contract v1.0): source, URL, data vintage, extraction instant, citation, license',
    ),
    attribution: z
      .array(z.string())
      .describe('Canonical source URLs of this response (attribution list)'),
  });
}

/**
 * Multi-source variant (`find_equivalent`, `validate_codes`): one block
 * per upstream source that contributed data — license segregation is a
 * contract rule, so blocks are never merged.
 */
export function withProvenanceMulti<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.extend({
    provenance: z
      .array(provenanceBlockSchema)
      .describe(
        'One provenance block per upstream source that contributed to this response (contract v1.0; licenses are never merged)',
      ),
    attribution: z
      .array(z.string())
      .describe('Canonical source URLs of this response (attribution list)'),
  });
}
