/**
 * CID-10 Client (Brazilian translation of ICD-10)
 *
 * Backed by the DataSUS V2008 release, bundled as JSON in
 * `src/data/cid10.json`. Pure in-memory: no HTTP, no rate limiter, no
 * retry, no cache. The dataset is frozen — V2008 has been the official
 * Brazilian SUS version since 2008 and has not received content updates.
 *
 * Source: http://www2.datasus.gov.br/cid10/V2008/ — published by CBCD
 * (Centro Brasileiro de Classificação de Doenças, USP) and distributed
 * by DataSUS.
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import dataset from '../data/cid10.json';

interface TabularSection<T> {
  fields: string[];
  rows: unknown[][];
  // Computed lazily on first access. We store the rehydrated objects so
  // hot paths (search, lookup) don't pay the rehydrate cost per call.
  __cached?: T[];
}

interface CID10Dataset {
  version: string;
  source: string;
  language: string;
  chapters: TabularSection<CID10Chapter>;
  groups: TabularSection<CID10Group>;
  categories: TabularSection<CID10Category>;
  subcategories: TabularSection<CID10Subcategory>;
}

export interface CID10Chapter {
  num: number;
  code_start: string;
  code_end: string;
  title: string;
  title_short: string;
}

export interface CID10Group {
  code_start: string;
  code_end: string;
  title: string;
  title_short: string;
}

export interface CID10Category {
  code: string;
  classif: string;
  title: string;
  title_short: string;
  refer: string;
  excluidos: string;
}

export interface CID10Subcategory {
  code: string;
  display: string;
  classif: string;
  restr_sexo: string;
  causa_obito: string;
  title: string;
  title_short: string;
  refer: string;
  excluidos: string;
}

export interface CID10SearchHit {
  level: 'category' | 'subcategory';
  code: string;
  display: string;
  classif: string;
  title: string;
  title_short: string;
  refer: string;
  excluidos: string;
  restr_sexo: string;
  causa_obito: string;
  chapter_num: number | null;
  group_range: string | null;
}

const ds = dataset as unknown as CID10Dataset;

function rehydrate<T>(section: TabularSection<T>): T[] {
  if (section.__cached) return section.__cached;
  const { fields, rows } = section;
  const out = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    fields.forEach((f, i) => {
      obj[f] = row[i];
    });
    return obj as T;
  });
  section.__cached = out;
  return out;
}

function chapters(): CID10Chapter[] {
  return rehydrate<CID10Chapter>(ds.chapters);
}

function groups(): CID10Group[] {
  return rehydrate<CID10Group>(ds.groups);
}

function categories(): CID10Category[] {
  return rehydrate<CID10Category>(ds.categories);
}

function subcategories(): CID10Subcategory[] {
  return rehydrate<CID10Subcategory>(ds.subcategories);
}

/**
 * Strips Portuguese diacritics (NFD decomposition + remove combining
 * marks). Used so that search queries match regardless of accent — a
 * user typing "infeccoes" finds "infecções", and vice versa.
 */
function deburr(s: string): string {
  // U+0300-U+036F is the Combining Diacritical Marks block — what NFD
  // decomposition produces from accented Portuguese letters (ã → a + ̃).
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Normalizes a CID-10 code to the canonical 3- or 4-char form used as
 * the storage key. Accepts dotted ("A00.1") and undotted ("A001") forms.
 * Returns uppercase. Returns null only for empty input.
 */
function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/\./g, '').trim();
}

/**
 * Returns "A00.1" for "A001" / "A00.1" inputs, or "A00" for "A00".
 */
function displayFor(code: string): string {
  if (code.length === 4) return `${code.slice(0, 3)}.${code.slice(3)}`;
  return code;
}

/**
 * Finds the chapter containing a given 3-char category code. Used to
 * enrich search/lookup hits with their chapter number.
 */
function chapterFor(catCode: string): number | null {
  for (const ch of chapters()) {
    if (catCode >= ch.code_start && catCode <= ch.code_end) return ch.num;
  }
  return null;
}

/**
 * Finds the group range containing a given 3-char category code.
 * Returned as a "Axx-Ayy" string; null if no group covers the code
 * (shouldn't happen for valid codes but handled defensively).
 */
function groupFor(catCode: string): string | null {
  for (const g of groups()) {
    if (catCode >= g.code_start && catCode <= g.code_end) {
      return `${g.code_start}-${g.code_end}`;
    }
  }
  return null;
}

function categoryToHit(c: CID10Category): CID10SearchHit {
  return {
    level: 'category',
    code: c.code,
    display: c.code,
    classif: c.classif,
    title: c.title,
    title_short: c.title_short,
    refer: c.refer,
    excluidos: c.excluidos,
    restr_sexo: '',
    causa_obito: '',
    chapter_num: chapterFor(c.code),
    group_range: groupFor(c.code),
  };
}

function subcategoryToHit(s: CID10Subcategory): CID10SearchHit {
  const cat3 = s.code.slice(0, 3);
  return {
    level: 'subcategory',
    code: s.code,
    display: s.display,
    classif: s.classif,
    title: s.title,
    title_short: s.title_short,
    refer: s.refer,
    excluidos: s.excluidos,
    restr_sexo: s.restr_sexo,
    causa_obito: s.causa_obito,
    chapter_num: chapterFor(cat3),
    group_range: groupFor(cat3),
  };
}

/**
 * CID-10 client. All methods are synchronous and operate on the bundled
 * dataset. Exposed via getCID10Client() singleton for symmetry with the
 * other clients, even though there's no shared state to manage.
 */
export class CID10Client {
  /** Returns dataset version string (e.g., "V2008"). */
  getVersion(): string {
    return ds.version;
  }

  /** Returns dataset source attribution. */
  getSource(): string {
    return ds.source;
  }

  /**
   * Searches categories and/or subcategories by Portuguese text. Match
   * is diacritic-insensitive and case-insensitive substring across
   * `title` and `title_short`.
   */
  search(
    query: string,
    level: 'categories' | 'subcategories' | 'all',
    maxResults: number,
  ): { totalCount: number; hits: CID10SearchHit[] } {
    const needle = deburr(query);
    if (needle.length === 0) {
      return { totalCount: 0, hits: [] };
    }

    const all: CID10SearchHit[] = [];

    if (level === 'categories' || level === 'all') {
      for (const c of categories()) {
        if (
          deburr(c.title).includes(needle) ||
          deburr(c.title_short).includes(needle)
        ) {
          all.push(categoryToHit(c));
        }
      }
    }

    if (level === 'subcategories' || level === 'all') {
      for (const s of subcategories()) {
        if (
          deburr(s.title).includes(needle) ||
          deburr(s.title_short).includes(needle)
        ) {
          all.push(subcategoryToHit(s));
        }
      }
    }

    return { totalCount: all.length, hits: all.slice(0, maxResults) };
  }

  /**
   * Looks up a single code. Accepts dotted ("A00.1") and undotted
   * ("A001") forms. Searches subcategories first (4-char codes), then
   * categories (3-char codes). Returns null when not found.
   */
  lookup(input: string): CID10SearchHit | null {
    const normalized = normalizeCode(input);

    if (normalized.length === 4) {
      const sub = subcategories().find((s) => s.code === normalized);
      if (sub) return subcategoryToHit(sub);
      return null;
    }

    if (normalized.length === 3) {
      const cat = categories().find((c) => c.code === normalized);
      if (cat) return categoryToHit(cat);
      return null;
    }

    return null;
  }

  /** Returns all 22 chapters in chapter-number order. */
  listChapters(): CID10Chapter[] {
    return chapters();
  }

  /**
   * Returns the chapter and its constituent groups. The dataset doesn't
   * store an explicit chapter→group link, so we filter groups whose
   * [code_start, code_end] interval falls inside the chapter's interval.
   */
  getChapter(num: number): { chapter: CID10Chapter | null; groups: CID10Group[] } {
    const chapter = chapters().find((c) => c.num === num) ?? null;
    if (!chapter) return { chapter: null, groups: [] };
    const inside = groups().filter(
      (g) => g.code_start >= chapter.code_start && g.code_end <= chapter.code_end,
    );
    return { chapter, groups: inside };
  }
}

let cid10ClientInstance: CID10Client | null = null;

export function getCID10Client(): CID10Client {
  if (!cid10ClientInstance) {
    cid10ClientInstance = new CID10Client();
  }
  return cid10ClientInstance;
}

// Helper exported for unit tests.
export const __test = { deburr, normalizeCode, displayFor };
