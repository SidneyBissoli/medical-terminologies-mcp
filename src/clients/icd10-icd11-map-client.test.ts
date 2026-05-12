import { describe, it, expect } from 'vitest';
import { getICD10ToICD11MapClient } from './icd10-icd11-map-client.js';

describe('ICD10ToICD11MapClient', () => {
  const client = getICD10ToICD11MapClient();

  it('reports the bundled WHO release version', () => {
    expect(client.getVersion()).toBe('2025-01');
  });

  it('reports the release date as WHO publishes it', () => {
    expect(client.getReleaseDate()).toBe('2025-Jan-24');
  });

  it('returns a non-trivial number of authoritative ICD-10 categories', () => {
    // The 2025-01 release has 11,243 category entries. Allow some drift
    // (±500) so a minor WHO point release doesn't break the test.
    expect(client.size()).toBeGreaterThan(10_500);
    expect(client.size()).toBeLessThan(12_000);
  });

  describe('lookup — well-known authoritative mappings', () => {
    it('maps E11 (Type 2 diabetes) → 5A11', () => {
      const entry = client.lookup('E11');
      expect(entry).not.toBeNull();
      expect(entry!.primary.code).toBe('5A11');
      expect(entry!.primary.title).toBe('Type 2 diabetes mellitus');
      expect(entry!.primary.chapter).toBe('05');
    });

    it('maps A00 (Cholera) → 1A00', () => {
      const entry = client.lookup('A00');
      expect(entry).not.toBeNull();
      expect(entry!.primary.code).toBe('1A00');
      expect(entry!.icd10.title).toBe('Cholera');
    });

    it('maps I21 (Acute MI) to a BA4* code', () => {
      const entry = client.lookup('I21');
      expect(entry).not.toBeNull();
      expect(entry!.primary.code).toMatch(/^BA4/);
    });

    it('surfaces multiple WHO-documented alternatives when present', () => {
      const entry = client.lookup('A07.8');
      expect(entry).not.toBeNull();
      // A07.8 had 4 alternatives in the 2025-01 release.
      expect(entry!.alternatives.length).toBeGreaterThanOrEqual(3);
    });

    it('returns null for chapter-level codes (e.g. "I")', () => {
      // Chapters aren't in the bundled dataset — the description tells users
      // to query a category instead.
      const entry = client.lookup('I');
      expect(entry).toBeNull();
    });

    it('returns null for block-level codes (e.g. "A00-A09")', () => {
      const entry = client.lookup('A00-A09');
      expect(entry).toBeNull();
    });

    it('returns null for a clearly invalid code', () => {
      expect(client.lookup('ZZ99')).toBeNull();
      expect(client.lookup('not-a-code')).toBeNull();
    });
  });

  describe('lookup — input normalization', () => {
    it('accepts the dotted display form "A07.8"', () => {
      expect(client.lookup('A07.8')).not.toBeNull();
    });

    it('accepts the undotted form "A078" and treats it as "A07.8"', () => {
      const dotted = client.lookup('A07.8');
      const undotted = client.lookup('A078');
      expect(undotted).not.toBeNull();
      expect(undotted!.primary.code).toBe(dotted!.primary.code);
    });

    it('is case-insensitive', () => {
      const upper = client.lookup('E11');
      const lower = client.lookup('e11');
      expect(lower).not.toBeNull();
      expect(lower!.primary.code).toBe(upper!.primary.code);
    });

    it('trims whitespace', () => {
      expect(client.lookup('  E11  ')).not.toBeNull();
    });
  });

  describe('lookup — payload shape', () => {
    it('each entry carries icd10 source, primary mapping, and alternatives array', () => {
      const entry = client.lookup('E11')!;
      expect(entry.icd10).toMatchObject({
        code: expect.any(String),
        title: expect.any(String),
        chapter: expect.any(String),
        depth: expect.any(Number),
      });
      expect(entry.primary).toMatchObject({
        code: expect.any(String),
        title: expect.any(String),
        chapter: expect.any(String),
        foundationUri: expect.stringMatching(/^http/),
        linearizationUri: expect.stringMatching(/^http/),
        classKind: expect.any(String),
        depth: expect.any(Number),
      });
      expect(Array.isArray(entry.alternatives)).toBe(true);
    });

    it('alternatives never contain the primary mapping', () => {
      const entry = client.lookup('A07.8')!;
      const primaryKey = `${entry.primary.code}|${entry.primary.foundationUri}`;
      for (const alt of entry.alternatives) {
        expect(`${alt.code}|${alt.foundationUri}`).not.toBe(primaryKey);
      }
    });
  });
});
