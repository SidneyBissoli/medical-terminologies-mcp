import { describe, it, expect } from 'vitest';
import { normalizeForMatch, lexicalScore, RANKING_METHOD_NOTE } from './lexical-score.js';

describe('normalizeForMatch', () => {
  it('lowercases, strips diacritics, collapses punctuation and whitespace', () => {
    expect(normalizeForMatch('Diabetes Mellitus, Type 2')).toBe('diabetes mellitus type 2');
    expect(normalizeForMatch('Hipertensão  arterial')).toBe('hipertensao arterial');
    expect(normalizeForMatch('  GLUCOSE [Mass/volume]  ')).toBe('glucose mass volume');
  });

  it('returns empty string for punctuation-only input', () => {
    expect(normalizeForMatch('—/;')).toBe('');
  });
});

describe('lexicalScore', () => {
  it('exact normalized match scores 1.0 regardless of case/punctuation', () => {
    expect(lexicalScore('diabetes', 'Diabetes')).toBe(1);
    expect(lexicalScore('type 2 diabetes', 'Type-2 Diabetes')).toBe(1);
  });

  it('scores 0 when no tokens overlap or title is empty/placeholder', () => {
    expect(lexicalScore('diabetes', 'Aspirin')).toBe(0);
    expect(lexicalScore('diabetes', '')).toBe(0);
    expect(lexicalScore('', 'Diabetes')).toBe(0);
  });

  it('terse titles outrank verbose ones with the same overlap (Dice penalty)', () => {
    const terse = lexicalScore('diabetes', 'Diabetes mellitus');
    const verbose = lexicalScore('diabetes', 'Diabetes mellitus due to genetic defect of beta cells');
    expect(terse).toBeGreaterThan(verbose);
    expect(terse).toBeGreaterThan(0);
    expect(verbose).toBeGreaterThan(0);
  });

  it('full-coverage titles outrank partial-coverage ones', () => {
    const full = lexicalScore('diabetes mellitus', 'Diabetes mellitus, type 2');
    const partial = lexicalScore('diabetes mellitus', 'Diabetes insipidus');
    expect(full).toBeGreaterThan(partial);
  });

  it('is deterministic and bounded to [0, 1] with 3-decimal rounding', () => {
    const s = lexicalScore('acute myocardial infarction', 'Acute myocardial infarction, unspecified');
    expect(s).toBe(lexicalScore('acute myocardial infarction', 'Acute myocardial infarction, unspecified'));
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBe(Math.round(s * 1000) / 1000);
  });

  it('matches across diacritics (pt-BR term vs ASCII title and vice versa)', () => {
    expect(lexicalScore('hipertensão', 'hipertensao')).toBe(1);
  });
});

describe('RANKING_METHOD_NOTE', () => {
  it('describes the server-side derivation (reused later by the provenance block)', () => {
    expect(RANKING_METHOD_NOTE).toContain('computed by this server');
    expect(RANKING_METHOD_NOTE).toContain('lexical similarity');
  });
});
