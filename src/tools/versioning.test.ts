import { describe, it, expect } from 'vitest';
import {
  TerminologyVersionsOutputSchema,
  TerminologyDiffOutputSchema,
} from '../types/index.js';
import { toolRegistry } from '../server-core.js';

// Side-effect import — registers the versioning tools.
import './versioning.js';

describe('terminology_versions', () => {
  const handler = toolRegistry.getHandler('terminology_versions');

  it('is registered', () => {
    expect(handler).toBeDefined();
  });

  it('returns all 8 terminologies when no filter is set', async () => {
    const result = await handler!({});
    const parsed = TerminologyVersionsOutputSchema.parse(result.structuredContent);
    expect(parsed.total).toBe(8);
    expect(parsed.terminologies).toHaveLength(8);

    const codes = parsed.terminologies.map((t) => t.code).sort();
    expect(codes).toEqual(
      ['atc', 'cid10', 'icd10', 'icd11', 'loinc', 'mesh', 'rxnorm', 'snomed'],
    );
  });

  it('filters to a single terminology when terminology is set', async () => {
    const result = await handler!({ terminology: 'cid10' });
    const parsed = TerminologyVersionsOutputSchema.parse(result.structuredContent);
    expect(parsed.total).toBe(1);
    expect(parsed.terminologies[0].code).toBe('cid10');
    expect(parsed.terminologies[0].current_version).toBe('V2008');
    expect(parsed.terminologies[0].bundled_in_server).toBe(true);
  });

  it('reports ICD-10 → ICD-11 transition table version live from the client', async () => {
    const result = await handler!({ terminology: 'icd10' });
    const parsed = TerminologyVersionsOutputSchema.parse(result.structuredContent);
    expect(parsed.terminologies[0].current_version).toBe('2025-01');
    expect(parsed.terminologies[0].bundled_in_server).toBe(true);
  });

  it('marks live-upstream terminologies as not bundled', async () => {
    const result = await handler!({ terminology: 'icd11' });
    const parsed = TerminologyVersionsOutputSchema.parse(result.structuredContent);
    expect(parsed.terminologies[0].bundled_in_server).toBe(false);
  });

  it('every entry has required metadata fields', async () => {
    const result = await handler!({});
    const parsed = TerminologyVersionsOutputSchema.parse(result.structuredContent);
    for (const t of parsed.terminologies) {
      expect(t.name).toBeTruthy();
      expect(t.full_name).toBeTruthy();
      expect(t.publisher).toBeTruthy();
      expect(t.current_version).toBeTruthy();
      expect(t.source_url).toMatch(/^https?:\/\//);
      expect(t.update_cadence).toBeTruthy();
    }
  });

  it('returns markdown content with a results table', async () => {
    const result = await handler!({});
    const block = result.content[0];
    expect(block.type).toBe('text');
    if (block.type !== 'text') throw new Error('unreachable');
    expect(block.text).toContain('# Terminology versions');
    expect(block.text).toContain('| Code | Name | Version |');
  });
});

describe('terminology_diff', () => {
  const handler = toolRegistry.getHandler('terminology_diff');

  it('is registered', () => {
    expect(handler).toBeDefined();
  });

  it('returns a real cross-revision summary for terminology=icd10', async () => {
    const result = await handler!({ terminology: 'icd10' });
    const parsed = TerminologyDiffOutputSchema.parse(result.structuredContent);
    expect(parsed.terminology).toBe('icd10');
    expect(parsed.diff_available).toBe(true);
    expect(parsed.cross_revision_summary).not.toBeNull();
    const s = parsed.cross_revision_summary!;
    // The bundled 2025-01 release has 11,243 categories with 1,461 splits.
    expect(s.icd10_categories_total).toBeGreaterThan(10_500);
    expect(s.icd10_categories_total).toBeLessThan(12_000);
    expect(s.one_to_one_mappings + s.one_to_many_splits).toBe(s.icd10_categories_total);
    expect(s.one_to_many_splits).toBeGreaterThan(1000);
    expect(s.avg_alternatives_when_split).toBeGreaterThan(0);
  });

  it('returns guidance for terminology=icd11 (no bundled snapshots)', async () => {
    const result = await handler!({ terminology: 'icd11' });
    const parsed = TerminologyDiffOutputSchema.parse(result.structuredContent);
    expect(parsed.terminology).toBe('icd11');
    expect(parsed.diff_available).toBe(false);
    expect(parsed.cross_revision_summary).toBeNull();
    expect(parsed.changelog_url).toMatch(/who\.int/);
    expect(parsed.message.toLowerCase()).toContain('cadence');
  });

  it('returns guidance for terminology=cid10 (single bundled version)', async () => {
    const result = await handler!({ terminology: 'cid10' });
    const parsed = TerminologyDiffOutputSchema.parse(result.structuredContent);
    expect(parsed.terminology).toBe('cid10');
    expect(parsed.diff_available).toBe(false);
    expect(parsed.bundled_versions).toContain('V2008');
  });

  it('returns guidance for terminology=loinc', async () => {
    const result = await handler!({ terminology: 'loinc' });
    const parsed = TerminologyDiffOutputSchema.parse(result.structuredContent);
    expect(parsed.diff_available).toBe(false);
    expect(parsed.changelog_url).toMatch(/loinc\.org/);
  });

  it('echoes from_version and to_version in the response', async () => {
    const result = await handler!({
      terminology: 'snomed',
      from_version: '2024-07-01',
      to_version: '2025-01-31',
    });
    const parsed = TerminologyDiffOutputSchema.parse(result.structuredContent);
    expect(parsed.from_version).toBe('2024-07-01');
    expect(parsed.to_version).toBe('2025-01-31');
  });

  it('rejects unknown terminology values via the schema', async () => {
    await expect(handler!({ terminology: 'unknown_terminology' })).resolves.toMatchObject({
      isError: true,
    });
  });
});
