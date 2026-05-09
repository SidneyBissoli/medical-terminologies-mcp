import { describe, it, expect } from 'vitest';
import { getCID10Client, __test } from './cid10-client.js';

describe('CID10Client', () => {
  const client = getCID10Client();

  it('loads the bundled DataSUS V2008 dataset', () => {
    expect(client.getVersion()).toBe('V2008');
    expect(client.getSource()).toMatch(/DataSUS/);
  });

  it('lists exactly 22 chapters (CID-10 V2008 has 22)', () => {
    const chapters = client.listChapters();
    expect(chapters).toHaveLength(22);
    expect(chapters[0].num).toBe(1);
    expect(chapters[21].num).toBe(22);
  });

  it('chapter 9 is "Doenças do aparelho circulatório" with range I00-I99', () => {
    const { chapter, groups } = client.getChapter(9);
    expect(chapter).not.toBeNull();
    expect(chapter!.title).toMatch(/circulatório/i);
    expect(chapter!.code_start).toBe('I00');
    expect(chapter!.code_end).toBe('I99');
    expect(groups.length).toBeGreaterThan(0);
    // I21 (acute MI) is in this chapter; its containing group should be present
    const hasMIGroup = groups.some((g) => 'I20' >= g.code_start && 'I20' <= g.code_end);
    expect(hasMIGroup).toBe(true);
  });

  it('lookup of 3-char category I21 resolves to acute MI', () => {
    const hit = client.lookup('I21');
    expect(hit).not.toBeNull();
    expect(hit!.level).toBe('category');
    expect(hit!.code).toBe('I21');
    expect(hit!.display).toBe('I21');
    expect(hit!.title.toLowerCase()).toMatch(/infarto/);
    expect(hit!.chapter_num).toBe(9);
  });

  it('lookup accepts dotted form A00.1 and undotted A001 equivalently', () => {
    const dotted = client.lookup('A00.1');
    const undotted = client.lookup('A001');
    expect(dotted).not.toBeNull();
    expect(undotted).not.toBeNull();
    expect(dotted!.code).toBe(undotted!.code);
    expect(dotted!.display).toBe('A00.1');
    expect(dotted!.level).toBe('subcategory');
  });

  it('lookup returns null for unknown codes', () => {
    // B98 is a gap between B97 and B99 in chapter I — confirmed missing
    // by enumerating the dataset.
    expect(client.lookup('B98')).toBeNull();
    expect(client.lookup('A999')).toBeNull();
  });

  it('search is diacritic-insensitive: "infeccoes" matches "infecções"', () => {
    const a = client.search('infeccoes', 'all', 5);
    const b = client.search('infecções', 'all', 5);
    expect(a.totalCount).toBeGreaterThan(0);
    expect(b.totalCount).toBeGreaterThan(0);
    // Both queries should hit the same accented entries
    expect(a.totalCount).toBe(b.totalCount);
  });

  it('search level filter restricts hit type', () => {
    const cats = client.search('diabetes', 'categories', 50);
    const subs = client.search('diabetes', 'subcategories', 50);
    expect(cats.hits.every((h) => h.level === 'category')).toBe(true);
    expect(subs.hits.every((h) => h.level === 'subcategory')).toBe(true);
  });

  it('search respects max_results limit', () => {
    const r = client.search('e', 'all', 3);
    expect(r.hits.length).toBeLessThanOrEqual(3);
    // Total may be far larger
    expect(r.totalCount).toBeGreaterThan(3);
  });

  it('search hits include chapter_num and group_range when resolvable', () => {
    const r = client.search('infarto', 'categories', 10);
    expect(r.hits.length).toBeGreaterThan(0);
    const i21 = r.hits.find((h) => h.code === 'I21');
    expect(i21).toBeDefined();
    expect(i21!.chapter_num).toBe(9);
    expect(i21!.group_range).toMatch(/^I\d{2}-I\d{2}$/);
  });

  it('empty query returns no hits', () => {
    const r = client.search('', 'all', 10);
    expect(r.totalCount).toBe(0);
    expect(r.hits).toHaveLength(0);
  });
});

describe('CID10 internal helpers', () => {
  it('deburr strips Portuguese diacritics and lowercases', () => {
    expect(__test.deburr('Infecções')).toBe('infeccoes');
    expect(__test.deburr('Diabetes')).toBe('diabetes');
    expect(__test.deburr('CRÔNICA')).toBe('cronica');
  });

  it('normalizeCode strips dots and uppercases', () => {
    expect(__test.normalizeCode('a00.1')).toBe('A001');
    expect(__test.normalizeCode('A001')).toBe('A001');
    expect(__test.normalizeCode(' I21 ')).toBe('I21');
  });

  it('displayFor inserts dot only on 4-char codes', () => {
    expect(__test.displayFor('I21')).toBe('I21');
    expect(__test.displayFor('A001')).toBe('A00.1');
  });
});
