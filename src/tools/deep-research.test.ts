/**
 * The Deep Research adapter: the pure pieces (canonical URLs, id parsing,
 * index entries, cross-source ranking) and the two handlers against the
 * bundled data only — every live upstream is made to FAIL here, which is the
 * local-install situation (no WHO credentials, no network) the fan-out must
 * survive: local sources still answer, the failed ones leave no block.
 * The mocked-upstream happy path is covered by output-contract.test.ts and
 * provenance-wiring.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toolRegistry } from '../server-core.js';
import '../register.js';
import {
  DEEP_RESEARCH_ID_PREFIXES,
  DEEP_RESEARCH_LIMIT,
  cid10ChapterEntries,
  cid10Entries,
  deepResearchFetch,
  getLocalIndex,
  parseDocId,
  urlIcd10,
  urlIcd10Chapter,
  urlIcd11,
  urlLoinc,
  urlMesh,
  urlRxNorm,
} from './deep-research.js';
import { getCID10Client } from '../clients/cid10-client.js';

describe('canonical public URLs (what ChatGPT cites)', () => {
  it('ICD-10 browser by dotted code and chapter by roman numeral', () => {
    expect(urlIcd10('A00.0')).toBe('https://icd.who.int/browse10/2019/en#/A00.0');
    expect(urlIcd10Chapter(1)).toBe('https://icd.who.int/browse10/2019/en#/I');
    expect(urlIcd10Chapter(22)).toBe('https://icd.who.int/browse10/2019/en#/XXII');
  });

  it('ICD-11 browser from a release URI keeps the release; a foundation URI opens the latest', () => {
    expect(urlIcd11('http://id.who.int/icd/release/11/2024-01/mms/1435254666')).toBe(
      'https://icd.who.int/browse/2024-01/mms/en#1435254666',
    );
    expect(urlIcd11('http://id.who.int/icd/entity/119724091')).toBe(
      'https://icd.who.int/browse/latest-release/mms/en#119724091',
    );
    expect(urlIcd11('http://id.who.int/icd/release/11/2024-01/mms/1435254666/unspecified')).toBe(
      'https://icd.who.int/browse/2024-01/mms/en#1435254666/unspecified',
    );
    expect(urlIcd11('http://id.who.int/icd/release/11/2024-01/mms')).toBeNull();
  });

  it('LOINC, RxNav and MeSH Browser pages', () => {
    expect(urlLoinc('2339-0')).toBe('https://loinc.org/2339-0');
    expect(urlRxNorm('6809')).toBe('https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=6809');
    expect(urlMesh('D003920')).toBe('https://meshb.nlm.nih.gov/record/ui?ui=D003920');
  });
});

describe('document ids', () => {
  it('parses every prefix and rejects unknown or empty keys', () => {
    expect(parseDocId('cid10:A00.0')).toEqual({ kind: 'cid10', key: 'A00.0' });
    expect(parseDocId('cid10-chapter:4')).toEqual({ kind: 'cid10Chapter', key: '4' });
    expect(parseDocId('icd11:5A11')).toEqual({ kind: 'icd11', key: '5A11' });
    expect(parseDocId('version:loinc')).toEqual({ kind: 'version', key: 'loinc' });
    expect(parseDocId('sidra:6579')).toBeNull();
    expect(parseDocId('cid10:')).toBeNull();
    expect(parseDocId('')).toBeNull();
  });

  it('every prefix ends with a colon and is distinct', () => {
    const prefixes = Object.values(DEEP_RESEARCH_ID_PREFIXES);
    for (const p of prefixes) expect(p.endsWith(':')).toBe(true);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe('the local index', () => {
  it('holds every CID-10 code once (the subcategory table repeats undivided categories), the 22 chapters and the 8 version records', () => {
    const cid10 = getCID10Client();
    const codes = new Set([...cid10.listCategories(), ...cid10.listSubcategories()].map((h) => h.display));
    expect(codes.size).toBeLessThan(cid10.listCategories().length + cid10.listSubcategories().length);
    const expected = codes.size + 22 + 8;
    const { index, byId } = getLocalIndex();
    expect(index.size).toBe(expected);
    expect(byId.size).toBe(expected);
    expect(index.search('A33', { limit: 5 }).filter((h) => h.id === 'cid10:A33')).toHaveLength(1);
    expect(byId.has('cid10:A00.0')).toBe(true);
    expect(byId.has('cid10-chapter:1')).toBe(true);
    expect(byId.has('version:cid10')).toBe(true);
  });

  it('index entries carry the dotted code as id, the code forms as keywords and the public URL', () => {
    const [entry] = cid10Entries([getCID10Client().lookup('A00.0')!]);
    expect(entry.id).toBe('cid10:A00.0');
    expect(entry.title).toMatch(/^CID-10 A00\.0 — /);
    expect(entry.keywords).toContain('A000');
    expect(entry.url).toBe(urlIcd10('A00.0'));
    const [chapter] = cid10ChapterEntries(getCID10Client().listChapters().slice(0, 1));
    expect(chapter.id).toBe('cid10-chapter:1');
    expect(chapter.url).toBe(urlIcd10Chapter(1));
  });

  it('finds Portuguese terms regardless of accents and case', () => {
    const { index } = getLocalIndex();
    const hits = index.search('INFARTO agudo do miocardio', { limit: DEEP_RESEARCH_LIMIT });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.id.startsWith('cid10:I21'))).toBe(true);
  });
});

describe('search and fetch with every live upstream unreachable', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED (test: no network)');
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('search still answers from the bundled data, with blocks only for the sources that answered', async () => {
    const result = await toolRegistry.getHandler('search')!({ query: 'diabetes mellitus' });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      results: Array<{ id: string; title: string; url: string }>;
      provenance: Array<{ source: string }>;
    };
    expect(sc.results.length).toBeGreaterThan(0);
    expect(sc.results.length).toBeLessThanOrEqual(DEEP_RESEARCH_LIMIT);
    for (const r of sc.results) {
      expect(r.id.startsWith('cid10:') || r.id.startsWith('version:') || r.id.startsWith('cid10-chapter:')).toBe(true);
      expect(r.url.startsWith('http')).toBe(true);
    }
    // DataSUS (CID-10) + server metadata (versions); WHO/LOINC/RxNav/MeSH failed → no block.
    expect(sc.provenance.map((b) => b.source)).toHaveLength(2);
    expect(sc.provenance[0].source).toContain('DataSUS');
    // The contract text is the JSON of the object — one block, no footer.
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({ results: sc.results });
  }, 15_000);

  it('a query that is a code finds that code (score on the full title, not only the label)', async () => {
    const result = await toolRegistry.getHandler('search')!({ query: 'E10' });
    const sc = result.structuredContent as { results: Array<{ id: string }> };
    expect(sc.results[0]?.id).toBe('cid10:E10');
  }, 15_000);

  it('search validates its input like every other tool (pedagogical error, not a throw)', async () => {
    const result = await toolRegistry.getHandler('search')!({});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('Validation error');
  });

  it('fetch renders a CID-10 code through cid10_lookup and carries its provenance', async () => {
    const reply = await deepResearchFetch('cid10:I21.0');
    expect(reply).not.toBeNull();
    expect(reply!.document.id).toBe('cid10:I21.0');
    expect(reply!.document.title).toMatch(/^CID-10 I21\.0 — /);
    expect(reply!.document.url).toBe(urlIcd10('I21.0'));
    expect(reply!.document.text).toContain('# CID-10 I21.0');
    expect(reply!.document.metadata).toEqual({ terminology: 'cid10', key: 'I21.0', rendered_by: 'cid10_lookup' });
    const prov = reply!.extras?.structured?.provenance as { source: string };
    expect(prov.source).toContain('DataSUS');
  });

  it('fetch renders a chapter and a version record', async () => {
    const chapter = await deepResearchFetch('cid10-chapter:9');
    expect(chapter!.document.title).toMatch(/^CID-10 — Capítulo IX: /);
    expect(chapter!.document.url).toBe(urlIcd10Chapter(9));
    const version = await deepResearchFetch('version:loinc');
    expect(version!.document.title).toMatch(/^LOINC — /);
    expect(version!.document.url).toBe('https://loinc.org/');
  });

  it('fetch of an unknown prefix or an absent CID-10 code is "not found", not an error', async () => {
    expect(await deepResearchFetch('sidra:6579')).toBeNull();
    // A well-formed code the V2008 dataset does not have (U99 exists — chapter XXII).
    const absent = ['U05', 'U06', 'U07', 'U08'].find((c) => getCID10Client().lookup(c) === null);
    expect(absent).toBeDefined();
    expect(await deepResearchFetch(`cid10:${absent}`)).toBeNull();
    expect(await deepResearchFetch('cid10-chapter:99')).toBeNull();
    const wire = await toolRegistry.getHandler('fetch')!({ id: 'sidra:6579' });
    expect(wire.isError).toBe(true);
    expect((wire.content[0] as { text: string }).text).toContain('Document not found');
  });

  it('fetch of a live id whose upstream is down surfaces the lookup error', async () => {
    const wire = await toolRegistry.getHandler('fetch')!({ id: 'loinc:2339-0' });
    expect(wire.isError).toBe(true);
    expect((wire.content[0] as { text: string }).text).toContain('`fetch` failed');
  }, 30_000);
});
