#!/usr/bin/env node
// Builds src/data/icd10-to-icd11.json from the WHO ICD-10 → ICD-11
// mapping release. Run once to produce the data file checked into git.
// Re-run when WHO publishes a new release (annual cycle).
//
//   node scripts/build-icd10-to-icd11-dataset.mjs
//
// Source: https://icdcdn.who.int/static/releasefiles/2025-01/mapping.zip
// Files inside the ZIP (UTF-8, tab-separated, CRLF):
//   - 10To11MapToOneCategory.txt       — primary 1:1 mapping
//   - 10To11MapToMultipleCategories.txt — all candidate ICD-11 codes per ICD-10
//   - 11To10*.txt                       — reverse direction (not used here)
//   - foundation_*.txt                  — Foundation-ID variants (not used here)
//
// Output shape (compact for bundle size; client rehydrates on startup):
//   {
//     version, released, generated, source,
//     entries: {
//       "<icd10Code>": {
//         icd10: { code, title, chapter, depth },
//         primary: { code, title, chapter, foundationUri, linearizationUri, classKind, depth } | null,
//         alternatives: [ { code, title, chapter, foundationUri, linearizationUri, classKind, depth } ]
//       }
//     }
//   }
// Only ICD-10 entities with classKind === 'category' are included.
// Chapters and blocks are excluded — they aren't used in clinical coding.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'scripts', '_tmp', 'who-icd-mapping');
const OUT_FILE = join(ROOT, 'src', 'data', 'icd10-to-icd11.json');

const RELEASE_VERSION = '2025-01';
const RELEASE_DATE = '2025-Jan-24';
const SOURCE_URL = `https://icdcdn.who.int/static/releasefiles/${RELEASE_VERSION}/mapping.zip`;

function readTSV(file) {
  const path = join(SRC_DIR, file);
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${path}. Download mapping.zip from ${SOURCE_URL} and unzip into ${SRC_DIR}.`,
    );
  }
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines.shift().split('\t').map((h) => h.trim());
  // The two files have slightly different column names (e.g. "10DepthInKind"
  // vs "Depth", "ICD-11 FoundationURI" vs "ICD-11 Foundation URI"); normalize
  // by treating column positions as authoritative since column ORDER is the
  // same across both files.
  return lines.map((line) => {
    const cells = line.split('\t');
    const row = {};
    header.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    // Positional aliases — robust to header variant.
    row._10ClassKind = cells[0]?.trim() ?? '';
    row._10Depth = cells[1]?.trim() ?? '';
    row._icd10Code = cells[2]?.trim() ?? '';
    row._icd10Chapter = cells[3]?.trim() ?? '';
    row._icd10Title = cells[4]?.trim() ?? '';
    row._11ClassKind = cells[5]?.trim() ?? '';
    row._11Depth = cells[6]?.trim() ?? '';
    row._foundationUri = cells[7]?.trim() ?? '';
    row._linearizationUri = cells[8]?.trim() ?? '';
    row._icd11Code = cells[9]?.trim() ?? '';
    row._icd11Chapter = cells[10]?.trim() ?? '';
    row._icd11Title = cells[11]?.trim() ?? '';
    return row;
  });
}

function pickICD11(row) {
  return {
    code: row._icd11Code,
    title: row._icd11Title,
    chapter: row._icd11Chapter,
    foundationUri: row._foundationUri,
    linearizationUri: row._linearizationUri,
    classKind: row._11ClassKind,
    depth: Number(row._11Depth) || 1,
  };
}

function pickICD10(row) {
  return {
    code: row._icd10Code,
    title: row._icd10Title,
    chapter: row._icd10Chapter,
    depth: Number(row._10Depth) || 1,
  };
}

function main() {
  const oneRows = readTSV('10To11MapToOneCategory.txt').filter(
    (r) => r._10ClassKind === 'category' && r._icd10Code,
  );
  const multiRows = readTSV('10To11MapToMultipleCategories.txt').filter(
    (r) => r._10ClassKind === 'category' && r._icd10Code,
  );

  const entries = {};

  // Pass 1: seed every ICD-10 category from the OneCategory file as the
  // primary mapping. This is the authoritative 1:1 source per WHO.
  for (const row of oneRows) {
    const code = row._icd10Code;
    if (!entries[code]) {
      entries[code] = {
        icd10: pickICD10(row),
        primary: pickICD11(row),
        alternatives: [],
      };
    }
  }

  // Pass 2: walk MultipleCategories and add every ICD-11 hit that isn't
  // already the primary as an alternative. Deduplicate by ICD-11 code +
  // foundation URI (some entries share a code with different foundation
  // IDs — e.g. postcoordinated expressions like `1A00&XN8P1`).
  for (const row of multiRows) {
    const code = row._icd10Code;
    const icd11 = pickICD11(row);
    const dedupKey = `${icd11.code}|${icd11.foundationUri}`;

    if (!entries[code]) {
      // Multi-only row (no OneCategory primary — unusual but possible).
      entries[code] = {
        icd10: pickICD10(row),
        primary: icd11,
        alternatives: [],
      };
      continue;
    }

    const existing = entries[code];
    const primaryKey = `${existing.primary.code}|${existing.primary.foundationUri}`;
    if (dedupKey === primaryKey) continue;
    if (existing.alternatives.some((a) => `${a.code}|${a.foundationUri}` === dedupKey)) continue;
    existing.alternatives.push(icd11);
  }

  const dataset = {
    version: RELEASE_VERSION,
    released: RELEASE_DATE,
    generated: new Date().toISOString().slice(0, 10),
    source: SOURCE_URL,
    license: 'WHO ICD-11 is © World Health Organization. The transition tables are published for free use per WHO terms.',
    entries,
  };

  return mkdir(dirname(OUT_FILE), { recursive: true })
    .then(() => writeFile(OUT_FILE, JSON.stringify(dataset), 'utf8'))
    .then(() => {
      const total = Object.keys(entries).length;
      const withAlts = Object.values(entries).filter((e) => e.alternatives.length > 0).length;
      console.log(`Wrote ${OUT_FILE}`);
      console.log(`  entries=${total} (with_alternatives=${withAlts})`);
    });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
