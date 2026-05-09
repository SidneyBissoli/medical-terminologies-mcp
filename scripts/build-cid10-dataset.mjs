#!/usr/bin/env node
// Builds src/data/cid10.json from the DataSUS V2008 CSV release.
// Run once to produce the data file checked into git. Re-run only when
// DataSUS publishes a new V20XX release (V2008 has been frozen since 2008).
//
//   node scripts/build-cid10-dataset.mjs
//
// Source: http://www2.datasus.gov.br/cid10/V2008/downloads/CID10CSV.zip
// CSVs are ISO-8859-1, semicolon-separated, with CRLF line endings.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'scripts', '_tmp');
const OUT_FILE = join(ROOT, 'src', 'data', 'cid10.json');

function readCSV(file) {
  const path = join(SRC_DIR, file);
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${path}. Download CID10CSV.zip from DataSUS and unzip into scripts/_tmp/.`,
    );
  }
  const buf = readFileSync(path);
  const text = new TextDecoder('iso-8859-1').decode(buf);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines.shift().split(';').map((h) => h.trim().replace(/;$/, ''));
  return lines.map((line) => {
    // Trailing semicolon is typical in DataSUS CSVs; split and strip.
    const cells = line.split(';');
    const row = {};
    header.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

// SUBCATEGORIAS uses 4-char code "A000"; the conventional display is "A00.0".
function formatSubcat(code) {
  if (code.length !== 4) return code;
  return `${code.slice(0, 3)}.${code.slice(3)}`;
}

// Tabular shape: { fields: [...], rows: [[...], ...] }. Repeating field
// names per row (typical JSON array-of-objects) inflates this dataset
// from ~3.3 MB to under 1.5 MB. Loader rehydrates rows into objects on
// startup using `fields` as the key list.
function tabular(rows, mapper) {
  const objs = rows.map(mapper);
  if (objs.length === 0) return { fields: [], rows: [] };
  const fields = Object.keys(objs[0]);
  return {
    fields,
    rows: objs.map((o) => fields.map((f) => o[f] ?? '')),
  };
}

function main() {
  const chapters = tabular(readCSV('CID-10-CAPITULOS.CSV'), (r) => ({
    num: Number(r.NUMCAP),
    code_start: r.CATINIC,
    code_end: r.CATFIM,
    title: r.DESCRICAO,
    title_short: r.DESCRABREV,
  }));

  const groups = tabular(readCSV('CID-10-GRUPOS.CSV'), (r) => ({
    code_start: r.CATINIC,
    code_end: r.CATFIM,
    title: r.DESCRICAO,
    title_short: r.DESCRABREV,
  }));

  const categories = tabular(readCSV('CID-10-CATEGORIAS.CSV'), (r) => ({
    code: r.CAT,
    classif: r.CLASSIF || '',
    title: r.DESCRICAO,
    title_short: r.DESCRABREV,
    refer: r.REFER || '',
    excluidos: r.EXCLUIDOS || '',
  }));

  const subcategories = tabular(readCSV('CID-10-SUBCATEGORIAS.CSV'), (r) => ({
    code: r.SUBCAT,
    display: formatSubcat(r.SUBCAT),
    classif: r.CLASSIF || '',
    restr_sexo: r.RESTRSEXO || '',
    causa_obito: r.CAUSAOBITO || '',
    title: r.DESCRICAO,
    title_short: r.DESCRABREV,
    refer: r.REFER || '',
    excluidos: r.EXCLUIDOS || '',
  }));

  const dataset = {
    version: 'V2008',
    source: 'DataSUS / CBCD - http://www2.datasus.gov.br/cid10/V2008/',
    language: 'pt-BR',
    chapters,
    groups,
    categories,
    subcategories,
  };

  return mkdir(dirname(OUT_FILE), { recursive: true })
    .then(() => writeFile(OUT_FILE, JSON.stringify(dataset), 'utf8'))
    .then(() => {
      console.log(`Wrote ${OUT_FILE}`);
      console.log(
        `  chapters=${chapters.rows.length} groups=${groups.rows.length} categories=${categories.rows.length} subcategories=${subcategories.rows.length}`,
      );
    });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
