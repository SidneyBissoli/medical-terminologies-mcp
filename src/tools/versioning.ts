/**
 * Versioning tools.
 *
 * - terminology_versions: lists all 8 supported terminologies with their
 *   current version, release date, publisher, source URL, and update
 *   cadence. Useful for pipeline maintainers who need to confirm what
 *   the server is querying against before running batch validation.
 *
 * - terminology_diff: reports what diff data is available between two
 *   versions of a terminology. For most terminologies this is guidance
 *   only (the server doesn't ship historical snapshots), but for
 *   ICD-10 → ICD-11 it surfaces real cross-revision statistics from the
 *   bundled WHO transition tables (counts of 1:1 mappings, splits,
 *   alternatives) — the ICD-10 → ICD-11 case is a structural diff
 *   between two revisions of the same WHO classification.
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/server';
import { toolRegistry } from '../server-core.js';
import { getICD10ToICD11MapClient } from '../clients/icd10-icd11-map-client.js';
import { getEnv } from '../utils/env.js';
import {
  TerminologyVersionsParamsSchema,
  TerminologyVersionsOutputSchema,
  TerminologyDiffParamsSchema,
  TerminologyDiffOutputSchema,
  type TerminologyVersionsOutput,
  type TerminologyDiffOutput,
  type ValidateCodesTerminology,
} from '../types/index.js';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
} from '../utils/zod-schema.js';

// ============================================================================
// Static metadata
//
// One source of truth for "what version of each terminology this server
// queries against today". When updating a bundled dataset (CID-10,
// ICD-10 → ICD-11) or the default WHO_ICD11_RELEASE_ID, bump the matching
// entry here too. The bundled ICD-10 → ICD-11 entry reads its version
// live from the client at request time, so that one self-syncs.
// ============================================================================

interface TerminologyMeta {
  code: ValidateCodesTerminology;
  name: string;
  full_name: string;
  publisher: string;
  current_version: string;
  release_date: string;
  source_url: string;
  changelog_url: string | null;
  update_cadence: string;
  bundled_in_server: boolean;
  notes: string | null;
}

function buildMetadata(): TerminologyMeta[] {
  const icd10MapClient = getICD10ToICD11MapClient();
  const whoIcd11Release = getEnv('WHO_ICD11_RELEASE_ID') ?? '2024-01';

  return [
    {
      code: 'icd11',
      name: 'ICD-11',
      full_name: 'International Classification of Diseases, 11th Revision',
      publisher: 'World Health Organization',
      current_version: whoIcd11Release,
      release_date: whoIcd11Release,
      source_url: 'https://icd.who.int/browse11',
      changelog_url: 'https://icd.who.int/browse11/Downloads/Download',
      update_cadence: 'annual',
      bundled_in_server: false,
      notes: `Server queries WHO ICD-11 API. Default release ${whoIcd11Release}; override via WHO_ICD11_RELEASE_ID env. Latest known WHO release: 2025-01.`,
    },
    {
      code: 'icd10',
      name: 'ICD-10',
      full_name: 'International Classification of Diseases, 10th Revision (WHO)',
      publisher: 'World Health Organization',
      current_version: icd10MapClient.getVersion(),
      release_date: icd10MapClient.getReleaseDate(),
      source_url: 'https://icd.who.int/browse10',
      changelog_url: 'https://icd.who.int/browse11/Downloads/Download',
      update_cadence: 'frozen (superseded by ICD-11)',
      bundled_in_server: true,
      notes: `Bundled as part of the WHO ICD-10 → ICD-11 transition tables (${icd10MapClient.getVersion()} release). 11,243 category entries.`,
    },
    {
      code: 'cid10',
      name: 'CID-10',
      full_name: 'Classificação Internacional de Doenças, 10ª revisão (Brazilian Portuguese)',
      publisher: 'Ministério da Saúde do Brasil — DataSUS / CBCD',
      current_version: 'V2008',
      release_date: '2008',
      source_url: 'http://www2.datasus.gov.br/cid10/V2008/',
      changelog_url: null,
      update_cadence: 'frozen since 2008',
      bundled_in_server: true,
      notes: 'DataSUS has not published a successor to V2008. Brazilian healthcare systems use this version operationally.',
    },
    {
      code: 'snomed',
      name: 'SNOMED CT',
      full_name: 'Systematized Nomenclature of Medicine — Clinical Terms (International Edition)',
      publisher: 'SNOMED International (IHTSDO)',
      current_version: '2025-01-31',
      release_date: '2025-01-31',
      source_url: 'https://www.snomed.org/',
      changelog_url: 'https://confluence.ihtsdotools.org/display/SCT/SNOMED+CT+International+Edition+Releases',
      update_cadence: 'bi-annual (January and July)',
      bundled_in_server: false,
      notes: 'Server queries a Snowstorm instance configured via SNOMED_BASE_URL. Latest known International Edition: 2025-01-31. License required.',
    },
    {
      code: 'loinc',
      name: 'LOINC',
      full_name: 'Logical Observation Identifiers Names and Codes',
      publisher: 'Regenstrief Institute',
      current_version: '2.79',
      release_date: '2025-02-18',
      source_url: 'https://loinc.org/',
      changelog_url: 'https://loinc.org/releases/',
      update_cadence: 'bi-annual',
      bundled_in_server: false,
      notes: 'Server queries via NLM Clinical Tables. Specific LOINC release version varies by NLM update cycle.',
    },
    {
      code: 'rxnorm',
      name: 'RxNorm',
      full_name: 'RxNorm normalized drug names',
      publisher: 'US National Library of Medicine',
      current_version: 'monthly',
      release_date: 'rolling',
      source_url: 'https://www.nlm.nih.gov/research/umls/rxnorm/',
      changelog_url: 'https://www.nlm.nih.gov/research/umls/rxnorm/docs/rxnormfiles.html',
      update_cadence: 'monthly (first Monday)',
      bundled_in_server: false,
      notes: 'Server queries the live RxNorm API; concept versions self-update with each monthly release.',
    },
    {
      code: 'mesh',
      name: 'MeSH',
      full_name: 'Medical Subject Headings',
      publisher: 'US National Library of Medicine',
      current_version: '2025',
      release_date: '2024-11-19',
      source_url: 'https://www.nlm.nih.gov/mesh/',
      changelog_url: 'https://www.nlm.nih.gov/mesh/intro_history.html',
      update_cadence: 'annual (November)',
      bundled_in_server: false,
      notes: 'Server queries the NLM MeSH Linked Data API.',
    },
    {
      code: 'atc',
      name: 'ATC',
      full_name: 'Anatomical Therapeutic Chemical Classification',
      publisher: 'WHO Collaborating Centre for Drug Statistics Methodology',
      current_version: '2025',
      release_date: '2024-12-13',
      source_url: 'https://www.whocc.no/atc_ddd_index/',
      changelog_url: 'https://www.whocc.no/atc_ddd_index_and_guidelines/atc_ddd_index/',
      update_cadence: 'annual',
      bundled_in_server: false,
      notes: 'Server queries the WHO ATC mirror exposed via NLM RxClass. Substance-level (7-char) codes only resolve via `atc_classify` by drug name.',
    },
  ];
}

// ============================================================================
// Tool definitions
// ============================================================================

const terminologyVersionsTool: Tool = {
  name: 'terminology_versions',
  description: `List the current version, release date, publisher, source URL, and update cadence of every terminology this server queries against.

Useful for pipeline maintainers who need to:
- Confirm which release of ICD-11 / SNOMED / LOINC / RxNorm / MeSH / ATC the server is querying before a batch run.
- Verify the bundled CID-10 (frozen at V2008) and ICD-10 → ICD-11 transition tables (currently 2025-01) match expectations.
- Cite the data version in research artifacts.

Pass \`terminology\` to filter to a single entry; otherwise the full set of 8 is returned. The ICD-10 → ICD-11 version reads live from the bundled dataset; everything else is metadata maintained alongside the project release.`,
  inputSchema: buildInputSchema(TerminologyVersionsParamsSchema),
  outputSchema: buildOutputSchema(TerminologyVersionsOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

const terminologyDiffTool: Tool = {
  name: 'terminology_diff',
  description: `Report what diff data is available between two versions of a terminology.

For most terminologies this is **guidance only** — the server doesn't ship historical snapshots, so the tool points at the publisher's official changelog and explains the cadence. \`bundled_versions\` lists the version(s) this server actually has on hand.

For **ICD-10 vs ICD-11** specifically, the tool surfaces a real cross-revision summary from the bundled WHO transition tables (the ICD-10 → ICD-11 case is a structural diff between two WHO revisions). Use \`terminology: "icd10"\` with no \`to_version\` to get the cross-revision summary: total mapped ICD-10 categories, how many are 1:1 vs split into multiple ICD-11 codes, and the average number of alternatives when split.

Inputs:
- \`terminology\` (required): which terminology to report on.
- \`from_version\` (optional): the version you have data from. If omitted, the tool reports against the currently-bundled version.
- \`to_version\` (optional): the version you want to compare to. If omitted, the tool reports against the publisher's latest known release.

This tool is intentionally a metadata + guidance layer, not a diff engine — for terminologies that change frequently (SNOMED, LOINC, RxNorm, MeSH), the publisher's official changelog is the authoritative source.`,
  inputSchema: buildInputSchema(TerminologyDiffParamsSchema),
  outputSchema: buildOutputSchema(TerminologyDiffOutputSchema),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

// ============================================================================
// Handlers
// ============================================================================

async function handleTerminologyVersions(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    const params = TerminologyVersionsParamsSchema.parse(args);
    const all = buildMetadata();
    const filtered = params.terminology
      ? all.filter((t) => t.code === params.terminology)
      : all;

    const lines: string[] = [];
    lines.push('# Terminology versions');
    lines.push('');
    lines.push(`Server snapshot — generated ${new Date().toISOString().slice(0, 10)}.`);
    lines.push('');
    lines.push('| Code | Name | Version | Release | Publisher | Cadence | Bundled |');
    lines.push('|------|------|---------|---------|-----------|---------|---------|');

    for (const t of filtered) {
      lines.push(
        `| ${t.code} | ${t.name} | ${t.current_version} | ${t.release_date} | ${t.publisher} | ${t.update_cadence} | ${t.bundled_in_server ? '✅' : '—'} |`,
      );
    }

    lines.push('');
    lines.push('## Notes per terminology');
    lines.push('');
    for (const t of filtered) {
      lines.push(`- **${t.name}**: ${t.notes ?? '(no notes)'}`);
      lines.push(`  - Source: ${t.source_url}`);
      if (t.changelog_url) {
        lines.push(`  - Changelog: ${t.changelog_url}`);
      }
    }

    const structured: TerminologyVersionsOutput = {
      generated: new Date().toISOString().slice(0, 10),
      total: filtered.length,
      terminologies: filtered,
    };

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  } catch (error) {
    return handleToolError(error);
  }
}

async function handleTerminologyDiff(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    const params = TerminologyDiffParamsSchema.parse(args);
    const meta = buildMetadata().find((t) => t.code === params.terminology);
    if (!meta) {
      // Shouldn't happen: the Zod enum guarantees a valid terminology.
      throw new Error(`Unknown terminology: ${params.terminology}`);
    }

    // ICD-10 case: surface the cross-revision summary from the bundled
    // WHO transition tables. This is the one real diff we can compute.
    if (params.terminology === 'icd10') {
      const client = getICD10ToICD11MapClient();
      const stats = client.getStats();
      const { total, oneToOne, split, avgAlternativesWhenSplit } = stats;

      const lines: string[] = [];
      lines.push('# ICD-10 → ICD-11 cross-revision summary');
      lines.push('');
      lines.push(
        `Source: WHO ICD-10 → ICD-11 transition tables, release ${client.getVersion()} (${client.getReleaseDate()}).`,
      );
      lines.push('');
      lines.push(`- **Total ICD-10 categories with an ICD-11 mapping:** ${total}`);
      lines.push(`- **1:1 mappings (single ICD-11 code):** ${oneToOne} (${Math.round((oneToOne / total) * 1000) / 10}%)`);
      lines.push(`- **Split mappings (multiple ICD-11 candidates):** ${split} (${Math.round((split / total) * 1000) / 10}%)`);
      lines.push(`- **Average ICD-11 alternatives when split:** ${avgAlternativesWhenSplit}`);
      lines.push('');
      lines.push(
        'Note: only ICD-10 categories that map to at least one ICD-11 entity are in the table. WHO does not include ICD-10 chapters and blocks because those aren\'t used in clinical coding. ICD-10 codes that have *no* ICD-11 representation are not enumerable from this dataset alone.',
      );

      const structured: TerminologyDiffOutput = {
        terminology: 'icd10',
        from_version: params.from_version ?? meta.current_version,
        to_version: params.to_version ?? null,
        diff_available: true,
        message: 'Cross-revision summary from bundled WHO ICD-10 → ICD-11 transition tables.',
        changelog_url: meta.changelog_url,
        bundled_versions: [meta.current_version],
        cross_revision_summary: {
          icd10_categories_total: total,
          one_to_one_mappings: oneToOne,
          one_to_many_splits: split,
          avg_alternatives_when_split: avgAlternativesWhenSplit,
        },
      };

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: structured,
      };
    }

    // All other terminologies: guidance only.
    const bundled = meta.bundled_in_server ? [meta.current_version] : [];
    const reason = meta.bundled_in_server
      ? `This server bundles ${meta.current_version} only — no historical snapshots are shipped, so a version-to-version diff isn't computable from the data on disk.`
      : `This server queries the upstream API for the current release (${meta.current_version}). It doesn't cache historical snapshots, so a version-to-version diff isn't computable from the data on disk.`;

    const message = [
      reason,
      '',
      `For ${meta.name} version differences, consult the publisher's official changelog:`,
      meta.changelog_url ? `  ${meta.changelog_url}` : `  ${meta.source_url}`,
      '',
      `Update cadence: ${meta.update_cadence}.`,
    ].join('\n');

    const lines: string[] = [];
    lines.push(`# ${meta.name} version diff — guidance`);
    lines.push('');
    lines.push(message);
    lines.push('');
    lines.push(
      `**Bundled versions on this server:** ${bundled.length > 0 ? bundled.join(', ') : '(none — server uses the live upstream)'}`,
    );

    const structured: TerminologyDiffOutput = {
      terminology: params.terminology,
      from_version: params.from_version ?? null,
      to_version: params.to_version ?? null,
      diff_available: false,
      message,
      changelog_url: meta.changelog_url,
      bundled_versions: bundled,
      cross_revision_summary: null,
    };

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

toolRegistry.register(terminologyVersionsTool, handleTerminologyVersions);
toolRegistry.register(terminologyDiffTool, handleTerminologyDiff);
