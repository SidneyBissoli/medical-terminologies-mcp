/**
 * ICD-10 → ICD-11 mapping client (authoritative).
 *
 * In-memory like CID-10 — no HTTP, no rate limiter, no cache. The
 * bundled dataset comes from the WHO ICD-10 → ICD-11 transition tables
 * (release 2025-01). To refresh, run:
 *
 *   node scripts/build-icd10-to-icd11-dataset.mjs
 *
 * after unzipping the latest WHO mapping.zip into
 * scripts/_tmp/who-icd-mapping/.
 *
 * @author Sidney Bissoli
 * @license MIT (mapping content © World Health Organization, free per WHO terms)
 */

import dataset from '../data/icd10-to-icd11.json';

export interface ICD11Mapping {
  code: string;
  title: string;
  chapter: string;
  foundationUri: string;
  linearizationUri: string;
  classKind: string;
  depth: number;
}

export interface ICD10Source {
  code: string;
  title: string;
  chapter: string;
  depth: number;
}

export interface ICD10ToICD11Entry {
  icd10: ICD10Source;
  primary: ICD11Mapping;
  alternatives: ICD11Mapping[];
}

interface Dataset {
  version: string;
  released: string;
  generated: string;
  source: string;
  license: string;
  entries: Record<string, ICD10ToICD11Entry>;
}

const ds = dataset as Dataset;

/**
 * Normalize an ICD-10 code for lookup. WHO tables use the canonical
 * dotted form (e.g. "A07.8"); accept both dotted and undotted (e.g.
 * "A078") plus case-insensitive input.
 */
function normalizeCode(input: string): string {
  const trimmed = input.trim().toUpperCase();
  // If it's 4 chars and matches the undotted pattern, insert the dot.
  if (/^[A-Z]\d{3}$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)}.${trimmed.slice(3)}`;
  }
  return trimmed;
}

export class ICD10ToICD11MapClient {
  /** Returns the release version (e.g. "2025-01"). */
  getVersion(): string {
    return ds.version;
  }

  /** Returns the release date as printed by WHO (e.g. "2025-Jan-24"). */
  getReleaseDate(): string {
    return ds.released;
  }

  /** Returns the source URL the dataset was built from. */
  getSourceUrl(): string {
    return ds.source;
  }

  /**
   * Look up an ICD-10 code. Returns the primary ICD-11 mapping plus any
   * alternatives (where WHO documents more than one ICD-11 candidate).
   * Returns `null` when the code isn't in the WHO category-level table —
   * chapters and blocks (e.g. "A00-A09") are NOT included in the bundled
   * dataset because they aren't used in clinical coding.
   */
  lookup(icd10Code: string): ICD10ToICD11Entry | null {
    const normalized = normalizeCode(icd10Code);
    return ds.entries[normalized] ?? null;
  }

  /** Total number of ICD-10 categories with an authoritative mapping. */
  size(): number {
    return Object.keys(ds.entries).length;
  }

  /**
   * Aggregate stats over the full bundled table. Used by the
   * terminology_diff tool to surface the structural diff between ICD-10
   * and ICD-11 (1:1 vs splits) without forcing that consumer to walk the
   * raw dataset.
   */
  getStats(): {
    total: number;
    oneToOne: number;
    split: number;
    avgAlternativesWhenSplit: number;
  } {
    let oneToOne = 0;
    let split = 0;
    let totalAltsInSplits = 0;
    for (const code of Object.keys(ds.entries)) {
      const entry = ds.entries[code];
      if (entry.alternatives.length === 0) {
        oneToOne += 1;
      } else {
        split += 1;
        totalAltsInSplits += entry.alternatives.length;
      }
    }
    const avg = split > 0 ? Math.round((totalAltsInSplits / split) * 100) / 100 : 0;
    return {
      total: Object.keys(ds.entries).length,
      oneToOne,
      split,
      avgAlternativesWhenSplit: avg,
    };
  }
}

let singleton: ICD10ToICD11MapClient | null = null;

export function getICD10ToICD11MapClient(): ICD10ToICD11MapClient {
  if (!singleton) {
    singleton = new ICD10ToICD11MapClient();
  }
  return singleton;
}
