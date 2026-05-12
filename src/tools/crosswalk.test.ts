/**
 * Tests for the validate_codes tool. Exercises the schema, the aggregation
 * math, and the two terminology branches served entirely from bundled
 * datasets (icd10, cid10) — these need zero network and stay fast.
 * The HTTP-backed branches (icd11, loinc, rxnorm, mesh, atc, snomed) share
 * the same handler shape and rely on their per-client contract tests for
 * upstream correctness.
 */

import { describe, it, expect } from 'vitest';
import {
  ValidateCodesParamsSchema,
  ValidateCodesOutputSchema,
} from '../types/index.js';
import { toolRegistry } from '../server-core.js';

// Side-effect import — registers the validate_codes tool (plus the other
// crosswalk handlers, harmless for these tests).
import './crosswalk.js';

describe('ValidateCodesParamsSchema', () => {
  it('accepts a 1-item batch with explicit terminology', () => {
    const r = ValidateCodesParamsSchema.safeParse({
      codes: [{ code: 'E11', terminology: 'icd10' }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an empty codes array', () => {
    const r = ValidateCodesParamsSchema.safeParse({ codes: [] });
    expect(r.success).toBe(false);
  });

  it('rejects more than 50 codes', () => {
    const codes = Array.from({ length: 51 }, () => ({
      code: 'A00',
      terminology: 'icd10' as const,
    }));
    const r = ValidateCodesParamsSchema.safeParse({ codes });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown terminology', () => {
    const r = ValidateCodesParamsSchema.safeParse({
      codes: [{ code: 'X', terminology: 'unknown_taxonomy' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects a missing terminology (auto-detect not supported)', () => {
    const r = ValidateCodesParamsSchema.safeParse({ codes: [{ code: 'E11' }] });
    expect(r.success).toBe(false);
  });

  it('rejects an empty code string', () => {
    const r = ValidateCodesParamsSchema.safeParse({
      codes: [{ code: '', terminology: 'icd10' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('validate_codes handler — in-memory branches', () => {
  // The handler is registered via side-effect import above; pull it from
  // the registry to test it through the same path the MCP dispatcher uses.
  const handler = toolRegistry.getHandler('validate_codes');

  it('is registered with the tool registry', () => {
    expect(handler).toBeDefined();
  });

  it('validates a known ICD-10 code and surfaces the ICD-11 replacement', async () => {
    const result = await handler!({
      codes: [{ code: 'E11', terminology: 'icd10' }],
    });
    const body = result.structuredContent;
    const parsed = ValidateCodesOutputSchema.parse(body);
    expect(parsed.total).toBe(1);
    expect(parsed.valid_count).toBe(1);
    expect(parsed.invalid_count).toBe(0);
    expect(parsed.error_count).toBe(0);
    expect(parsed.results[0]).toMatchObject({
      code: 'E11',
      terminology: 'icd10',
      valid: true,
      active: null,
      title: 'Type 2 diabetes mellitus',
      // The bundled WHO table maps E11 → 5A11.
      replaced_by: expect.stringContaining('5A11'),
      error: null,
    });
    expect(parsed.results[0].source).toMatch(/WHO ICD-10 → ICD-11/);
  });

  it('flags an unknown ICD-10 code as valid:false with error:null', async () => {
    const result = await handler!({
      codes: [{ code: 'ZZ99', terminology: 'icd10' }],
    });
    const parsed = ValidateCodesOutputSchema.parse(result.structuredContent);
    expect(parsed.results[0]).toMatchObject({
      code: 'ZZ99',
      terminology: 'icd10',
      valid: false,
      error: null,
    });
    expect(parsed.invalid_count).toBe(1);
    expect(parsed.error_count).toBe(0);
  });

  it('validates a known CID-10 category code', async () => {
    // A00 is Cólera in CID-10 (DataSUS V2008 Brazilian Portuguese).
    const result = await handler!({
      codes: [{ code: 'A00', terminology: 'cid10' }],
    });
    const parsed = ValidateCodesOutputSchema.parse(result.structuredContent);
    expect(parsed.results[0]).toMatchObject({
      code: 'A00',
      terminology: 'cid10',
      valid: true,
      active: null,
      replaced_by: null,
      error: null,
    });
    expect(parsed.results[0].title).toBeTruthy();
    expect(parsed.results[0].source).toMatch(/DataSUS/);
  });

  it('aggregates a mixed batch correctly (valid + invalid in the same call)', async () => {
    const result = await handler!({
      codes: [
        { code: 'E11', terminology: 'icd10' },
        { code: 'A00', terminology: 'cid10' },
        { code: 'ZZ99', terminology: 'icd10' },
        { code: 'NOT_A_CODE', terminology: 'cid10' },
      ],
    });
    const parsed = ValidateCodesOutputSchema.parse(result.structuredContent);
    expect(parsed.total).toBe(4);
    expect(parsed.valid_count).toBe(2);
    expect(parsed.invalid_count).toBe(2);
    expect(parsed.error_count).toBe(0);
    // Order preserved from input — important for callers correlating with
    // their source database row order.
    expect(parsed.results.map((r) => r.code)).toEqual([
      'E11',
      'A00',
      'ZZ99',
      'NOT_A_CODE',
    ]);
  });

  it('returns markdown content with a results table', async () => {
    const result = await handler!({
      codes: [{ code: 'E11', terminology: 'icd10' }],
    });
    expect(result.content).toHaveLength(1);
    const block = result.content[0];
    expect(block.type).toBe('text');
    if (block.type !== 'text') throw new Error('unreachable');
    expect(block.text).toContain('# Code Validation Results');
    expect(block.text).toContain('| Code | Terminology |');
    expect(block.text).toContain('E11');
    expect(block.text).toContain('5A11');
  });
});
